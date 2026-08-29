import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaTokenPayload } from "@facecards/shared";
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
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);

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
        setRemotes((prev) => {
          if (!prev.has(peerId)) return prev;
          const next = new Map(prev);
          next.delete(peerId);
          return next;
        });
      }),
      provider.onSpeaking((peerId, isSpeaking) => {
        setSpeaking((prev) => {
          const next = new Set(prev);
          if (isSpeaking) next.add(peerId);
          else next.delete(peerId);
          return next;
        });
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
    };
  }, [token]);

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

  return {
    state,
    error,
    remotes,
    localVideo,
    speaking,
    micMuted,
    cameraOff,
    audioBlocked,
    toggleMic,
    toggleCamera,
    startAudio,
  };
}
