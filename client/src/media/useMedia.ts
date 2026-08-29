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
  const faceBoxes = useMemo(() => createFaceBoxStore(), []);

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
    ];

    void (async () => {
      try {
        await provider.connect(token);
        if (cancelled) return;
        // Spec section 2: voice open by default once permission is granted.
        await provider.publishLocal({ camera: true, mic: true });
        if (cancelled) return;
        setLocalVideo(provider.getLocalVideo());
        setMicMuted(provider.isMuted("audio"));
        setCameraOff(provider.isMuted("video"));
      } catch (err) {
        if (cancelled) return;
        // Denied permission lands here. Phase 6 turns each of these into a
        // recoverable flow; phase 0 only has to not lie about what happened.
        setError(err instanceof Error ? err.message : String(err));
        setState("failed");
      }
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
  }, [token, faceBoxes]);

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
