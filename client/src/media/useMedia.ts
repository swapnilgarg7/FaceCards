import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaTokenPayload } from "@facecards/shared";
import {
  decodeFaceBox,
  encodeFaceBox,
  FACE_BOX_TOPIC,
  type FaceBox,
} from "../scene/faceBox.js";
import {
  createFaceBoxStore,
  type FaceBoxStore,
} from "../scene/faceBoxStore.js";
import {
  canAttempt,
  diffDevices,
  summariseDevices,
  NO_DEVICES,
  type DeviceSummary,
} from "./devices.js";
import {
  classifyMediaError,
  deviceLostFault,
  worseFault,
  type MediaFault,
  type TrackKind,
} from "./faults.js";
import { watchMediaPermission } from "./permissions.js";
import {
  createMediaProvider,
  type MediaConnectionState,
  type MediaProvider,
} from "./index.js";

/**
 * Media lifecycle as a hook. Still vendor-neutral: this file talks only to
 * `MediaProvider` and `HTMLVideoElement`.
 *
 * Remote elements are exposed as a map of peerId -> element. In phase 0 the UI
 * puts them in `<video>` tags; in phase 1 the same elements become
 * `THREE.VideoTexture` on avatar face planes, and this hook does not change.
 */

export interface UseMedia {
  state: MediaConnectionState;
  error: string | null;
  /**
   * What is wrong with this player's own camera or microphone, and whether a
   * button would help. Null when there is nothing wrong.
   *
   * The phase-6 exit criterion is that every permission denial path is
   * recoverable without a page reload, which is a claim about this field and
   * `recover` below: between them they have to cover a refusal, an absent
   * device, a device unplugged mid-session, a device taken by another app, and
   * a permission revoked from the browser's own settings while somebody is
   * sitting at the table.
   */
  fault: MediaFault | null;
  /**
   * Try the local devices again. Safe to call at any time; a no-op before the
   * provider exists.
   *
   * Resolves whether or not it worked - the outcome is in `fault`, because the
   * banner that offers this button is the same banner that has to report what
   * happened next.
   */
  recover(): Promise<void>;
  /** True while `recover` is in flight, so the button can say so. */
  recovering: boolean;
  /** peerId -> attached, playing element. Identity is the Colyseus sessionId. */
  remotes: Map<string, HTMLVideoElement>;
  localVideo: HTMLVideoElement | null;
  speaking: Set<string>;
  /** peerIds whose mic is muted. Not the same as having no audio track. */
  remoteMicMuted: Set<string>;
  /** peerIds whose camera is off. Their face plane shows a placeholder. */
  remoteCameraOff: Set<string>;
  /**
   * Where each peer's face sits in their own frame. Not React state: it is
   * written a dozen times a second per peer and read inside `useFrame`.
   */
  faceBoxes: FaceBoxStore;
  /** Broadcast our own framing. Null means "tracking, no face right now". */
  sendFaceBox(box: FaceBox | null): void;
  /**
   * Ask for a peer's video at a given layer. Driven by camera yaw from
   * `scene/AttentionDirector.tsx`, on top of the `adaptiveStream` baseline.
   *
   * Stable across renders, because it is called from inside `useFrame`: a new
   * function identity every render would make the scene re-subscribe its frame
   * loop for no reason.
   */
  setQuality(peerId: string, quality: "high" | "medium" | "low"): void;
  micMuted: boolean;
  cameraOff: boolean;
  audioBlocked: boolean;
  toggleMic(): Promise<void>;
  toggleCamera(): Promise<void>;
  startAudio(): Promise<void>;
}

export function useMedia(token: MediaTokenPayload | null): UseMedia {
  const providerRef = useRef<MediaProvider | null>(null);
  const [state, setState] = useState<MediaConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [remotes, setRemotes] = useState<Map<string, HTMLVideoElement>>(
    new Map(),
  );
  const [localVideo, setLocalVideo] = useState<HTMLVideoElement | null>(null);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [remoteMicMuted, setRemoteMicMuted] = useState<Set<string>>(new Set());
  const [remoteCameraOff, setRemoteCameraOff] = useState<Set<string>>(
    new Set(),
  );
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [fault, setFault] = useState<MediaFault | null>(null);
  const [recovering, setRecovering] = useState(false);
  const faceBoxes = useMemo(() => createFaceBoxStore(), []);
  /**
   * What was plugged in last time we looked.
   *
   * A ref rather than state: `devicechange` fires for a pair of headphones as
   * readily as for a webcam, and on some machines twice for one physical
   * event, so this is compared far more often than it is acted on. Rendering
   * the room to discover that nothing relevant moved is exactly the work the
   * scene must not do.
   */
  const devicesRef = useRef<DeviceSummary>(NO_DEVICES);
  /**
   * The current fault, readable outside a render.
   *
   * The device watcher below has to ask "is there a fault, and would a retry
   * fix it?" from inside an async callback, and the obvious way to do that -
   * reading it inside a `setFault` updater - is wrong: a state updater must be
   * pure, and React calls it twice under StrictMode, so an automatic retry
   * fired from in there would run twice and open the camera twice.
   */
  const faultRef = useRef<MediaFault | null>(null);
  faultRef.current = fault;

  /**
   * Raise a fault, keeping whichever of the two the player can do least about.
   *
   * A camera that is merely busy must never hide a permission that has been
   * revoked: one is a click away from working and the other needs the browser,
   * and there is only room for one line over a poker table. See `worseFault`.
   */
  const raise = useCallback((next: MediaFault) => {
    setFault((current) => worseFault(current, next));
  }, []);

  useEffect(() => {
    if (!token) return;
    if (!token.ok) {
      setError(token.message);
      setState("failed");
      return;
    }

    const provider = createMediaProvider();
    providerRef.current = provider;
    let cancelled = false;

    const unsubs = [
      provider.onRemoteVideo((peerId, el) => {
        setRemotes((prev) => new Map(prev).set(peerId, el));
      }),
      provider.onRemoteGone((peerId) => {
        faceBoxes.forget(peerId);
        setRemotes((prev) => {
          if (!prev.has(peerId)) return prev;
          const next = new Map(prev);
          next.delete(peerId);
          return next;
        });
      }),
      provider.onData((peerId, topic, payload) => {
        if (topic !== FACE_BOX_TOPIC) return;
        const decoded = decodeFaceBox(payload);
        // Dropped silently. A malformed datagram is a peer on a different
        // build or a peer being clever, and in both cases the correct answer
        // is that their avatar keeps the framing it already had.
        if (decoded.kind === "invalid") return;
        faceBoxes.receive(
          peerId,
          decoded.kind === "box" ? decoded.box : null,
        );
      }),
      provider.onSpeaking((peerId, isSpeaking) => {
        setSpeaking((prev) => {
          const next = new Set(prev);
          if (isSpeaking) next.add(peerId);
          else next.delete(peerId);
          return next;
        });
      }),
      provider.onRemoteMute((peerId, kind, muted) => {
        const apply = (prev: Set<string>) => {
          if (muted === prev.has(peerId)) return prev;
          const next = new Set(prev);
          if (muted) next.add(peerId);
          else next.delete(peerId);
          return next;
        };
        if (kind === "audio") setRemoteMicMuted(apply);
        else setRemoteCameraOff(apply);
      }),
      provider.onConnectionState(setState),
      provider.onAudioBlocked(setAudioBlocked),
      // The webcam was unplugged, or the OS handed it to something else.
      // Nothing throws when this happens: the track ends, and without this the
      // only symptom is a still photograph of somebody who is still talking.
      provider.onLocalTrackEnded((kind) => raise(deviceLostFault(kind))),
      // An acquisition the SDK started by itself - reacquiring after a device
      // change, restoring after a reconnect - with no promise for the failure
      // to land on.
      provider.onDeviceError((err, kind) =>
        raise(classifyMediaError(err, kind ? [kind] : ["audio", "video"])),
      ),
    ];

    void (async () => {
      // Connecting and publishing are separated on purpose, and it is the one
      // structural change phase 6 made to this effect.
      //
      // They used to share a `try`, so a refused camera came out as a failed
      // *connection*: the player was dropped to `failed` and the table went
      // away, over a device. But those are not the same event at all. Failing
      // to reach the SFU means nobody can see or hear anybody; failing to open
      // a camera means one person is not being seen, at a table they are
      // otherwise fully seated at, talking to five people who can hear them
      // fine. The first is a disconnection. The second is a fault with a
      // button on it, and the product's whole argument is that being in the
      // room beats having the features.
      try {
        await provider.connect(token);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setState("failed");
        return;
      }
      if (cancelled) return;

      try {
        // Spec section 2: voice open by default once permission is granted.
        await provider.publishLocal({ camera: true, mic: true });
      } catch (err) {
        if (cancelled) return;
        // Denied permission lands here, and so do a busy camera, a missing one
        // and a driver that will not start. Which of those it was decides
        // whether the banner offers a button at all, so the exception is
        // classified rather than stringified.
        raise(classifyMediaError(err));
      }
      if (cancelled) return;
      // Read regardless of which branch ran: a failure to publish the camera
      // does not mean the microphone failed too, and half a publication is
      // still worth reflecting.
      setLocalVideo(provider.getLocalVideo());
      setMicMuted(provider.isMuted("audio"));
      setCameraOff(provider.isMuted("video"));
    })();

    return () => {
      cancelled = true;
      for (const unsub of unsubs) unsub();
      void provider.disconnect();
      providerRef.current = null;
      setRemotes(new Map());
      setLocalVideo(null);
      setSpeaking(new Set());
      setRemoteMicMuted(new Set());
      setRemoteCameraOff(new Set());
      faceBoxes.clear();
    };
  }, [token, faceBoxes, raise]);

  /**
   * Take the local devices from the top.
   *
   * The single recovery verb, behind every "Try again" in the product, and it
   * is deliberately one function rather than one per failure: from here a
   * denied permission that has since been allowed, a webcam that has been
   * plugged back in, and a conferencing app that has finally let go of the
   * camera are all the same act - ask the platform again and see what happens.
   *
   * The enumeration first is not an optimisation. Asking for a camera on a
   * machine that has none produces a `NotFoundError`, which would be
   * classified, shown, and would replace an accurate message ("your camera was
   * unplugged") with a worse one ("no camera was found") - so the attempt is
   * only made when it could possibly succeed.
   */
  const recover = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider) return;
    setRecovering(true);
    try {
      const devices = await navigator.mediaDevices
        ?.enumerateDevices()
        .catch(() => []);
      const summary = summariseDevices(devices ?? []);
      devicesRef.current = summary;

      const wanted: TrackKind[] = [];
      if (summary.mics > 0) wanted.push("audio");
      if (summary.cameras > 0) wanted.push("video");
      if (wanted.length === 0) {
        // Nothing to open. The fault already on screen says so more precisely
        // than a fresh `NotFoundError` would.
        return;
      }

      await provider.restartLocal({
        mic: wanted.includes("audio"),
        camera: wanted.includes("video"),
      });
      // Cleared only on the way *out* of a successful restart. Clearing it
      // before the attempt would blank the banner for the second the attempt
      // takes and then bring it back, which reads as a flicker rather than as
      // a retry.
      setFault(null);
      setLocalVideo(provider.getLocalVideo());
      setMicMuted(provider.isMuted("audio"));
      setCameraOff(provider.isMuted("video"));
    } catch (err) {
      // Replaces rather than merges: this is the freshest possible statement
      // about the same devices, and keeping the older one would mean a retry
      // that changed the situation still showed the situation before it.
      setFault(classifyMediaError(err));
    } finally {
      setRecovering(false);
    }
  }, []);

  /**
   * Something was plugged in or pulled out.
   *
   * `devicechange` carries no payload - the browser says *that* the list moved
   * and leaves working out *how* to the page - so this diffs counts and acts
   * on two transitions only. Losing the last camera is a fault, because from
   * this moment the avatar shows a photograph. Gaining one while a retryable
   * fault is on screen is an automatic retry, because somebody plugging a
   * webcam back in has already expressed what they want and should not also
   * have to find a button.
   */
  useEffect(() => {
    const devices = navigator.mediaDevices;
    if (!devices?.addEventListener) return;

    let live = true;
    const refresh = (act: boolean) => {
      void devices
        .enumerateDevices()
        .then((list) => {
          if (!live) return;
          const before = devicesRef.current;
          const after = summariseDevices(list);
          devicesRef.current = after;
          if (!act) return;

          const delta = diffDevices(before, after);
          for (const kind of delta.lost) raise(deviceLostFault(kind));
          // Only ever retries a fault a retry could fix. A denial stays put:
          // plugging in a second camera does not grant permission, and an
          // automatic attempt would fail and say the same thing again.
          const current = faultRef.current;
          if (
            delta.gained.length > 0 &&
            current?.retryable &&
            canAttempt(after, current.tracks)
          ) {
            void recover();
          }
        })
        .catch(() => {
          // An enumeration that fails tells us nothing, and inventing a fault
          // out of not knowing would be worse than staying quiet.
        });
    };

    // Seed the baseline without acting on it: the first enumeration is not a
    // change, and treating it as one would report every machine as having just
    // gained a camera.
    refresh(false);
    const onChange = () => refresh(true);
    devices.addEventListener("devicechange", onChange);
    return () => {
      live = false;
      devices.removeEventListener("devicechange", onChange);
    };
  }, [raise, recover]);

  /**
   * Permission taken away, or given back, from the browser's own settings.
   *
   * The case with no other symptom: nothing fails, nothing throws, and the
   * last decoded frame simply stays on the avatar's face. See
   * `watchMediaPermission` - and note that Safari and Firefox do not implement
   * the descriptor this needs, so on those browsers a revocation is noticed
   * only when something next fails.
   */
  useEffect(
    () =>
      watchMediaPermission({
        onLost: raise,
        // Granted again, in another tab, without touching this one. Attempt the
        // devices rather than merely clearing the message: permission alone
        // does not restart a track that has already ended.
        onRegained: () => void recover(),
      }),
    [raise, recover],
  );

  const toggleMic = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider) return;
    const next = !provider.isMuted("audio");
    await provider.setMuted("audio", next);
    setMicMuted(provider.isMuted("audio"));
  }, []);

  const toggleCamera = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider) return;
    const next = !provider.isMuted("video");
    await provider.setMuted("video", next);
    setCameraOff(provider.isMuted("video"));
    setLocalVideo(provider.getLocalVideo());
  }, []);

  const startAudio = useCallback(async () => {
    await providerRef.current?.startAudio();
    setAudioBlocked(false);
  }, []);

  const sendFaceBox = useCallback((box: FaceBox | null) => {
    providerRef.current?.sendData(FACE_BOX_TOPIC, encodeFaceBox(box));
  }, []);

  const setQuality = useCallback(
    (peerId: string, quality: "high" | "medium" | "low") => {
      // A no-op before connect and after leave, like `sendFaceBox`: the scene
      // runs on a frame loop that knows nothing about room lifecycle.
      providerRef.current?.setQuality(peerId, quality);
    },
    [],
  );

  return {
    state,
    error,
    fault,
    recover,
    recovering,
    remotes,
    localVideo,
    speaking,
    remoteMicMuted,
    remoteCameraOff,
    faceBoxes,
    sendFaceBox,
    setQuality,
    micMuted,
    cameraOff,
    audioBlocked,
    toggleMic,
    toggleCamera,
    startAudio,
  };
}
