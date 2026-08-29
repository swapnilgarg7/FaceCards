/**
 * The media boundary.
 *
 * This file names no vendor, and nothing outside `client/src/media/` may
 * import a vendor SDK. The rest of the app - and from phase 1, the 3D scene -
 * consumes `HTMLVideoElement`, which every WebRTC provider can hand over.
 *
 * Rationale in `docs/TECH-DECISIONS.md` ("Media provider: exit strategy and
 * portability"). Short version: LiveKit's `adaptiveStream` is the one thing
 * that would not port cleanly, so the cost of leaving is real, and the way to
 * keep that cost bounded is to keep the surface this small. It is an afternoon
 * now and a rewrite once six modules import the SDK directly.
 *
 * The scene binds these elements to `THREE.VideoTexture` on avatar face planes
 * in `client/src/avatars/useFaceTexture.ts`, and did so without this file
 * having to change, which is the boundary earning its keep.
 */

export type TrackKind = "audio" | "video";

export type MediaConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";

/** Credentials handed down from the game server. Vendor-shaped by the server. */
export interface MediaCredentials {
  url: string;
  token: string;
  identity: string;
  room: string;
}

export interface PublishOptions {
  camera: boolean;
  mic: boolean;
}

/** Unsubscribe handle. Every `on*` returns one; call it on teardown. */
export type Unsubscribe = () => void;

export interface MediaProvider {
  connect(credentials: MediaCredentials): Promise<void>;
  disconnect(): Promise<void>;

  /**
   * Publish local tracks. Camera is published with simulcast on, without
   * which `adaptiveStream` and any later per-peer quality control have no
   * layers to choose between.
   */
  publishLocal(opts: PublishOptions): Promise<void>;

  /** Toggle a local track. Both directions must always be available. */
  setMuted(kind: TrackKind, muted: boolean): Promise<void>;
  isMuted(kind: TrackKind): boolean;

  /**
   * The local camera preview element. Mirrored for self-view, which is what
   * people expect of their own image and wrong for everyone else's.
   */
  getLocalVideo(): HTMLVideoElement | null;

  /**
   * The two the 3D scene cares about. `el` is already attached and playing;
   * it may be off-screen or zero-opacity, but it must stay in the DOM or
   * visibility-driven quality negotiation silently stops working.
   */
  onRemoteVideo(cb: (peerId: string, el: HTMLVideoElement) => void): Unsubscribe;
  onRemoteGone(cb: (peerId: string) => void): Unsubscribe;

  /** Spec sections 6 and 12: focus-driven quality. */
  setQuality(peerId: string, q: "high" | "medium" | "low"): void;

  onSpeaking(cb: (peerId: string, speaking: boolean) => void): Unsubscribe;

  /**
   * Remote mute state, which is not the same thing as an absent track: a
   * muted camera stays subscribed and simply stops producing frames, so
   * without this the avatar's face plane freezes on the last frame instead of
   * falling back to a placeholder. Spec section 7 also wants a mute icon on
   * the avatar's chest, and this is where that state comes from.
   */
  onRemoteMute(
    cb: (peerId: string, kind: TrackKind, muted: boolean) => void,
  ): Unsubscribe;

  onConnectionState(cb: (state: MediaConnectionState) => void): Unsubscribe;

  /**
   * Autoplay recovery. Browsers block audio playback until a user gesture, so
   * the UI needs to know when to show a "click to enable sound" affordance and
   * needs something to call when it is clicked.
   */
  onAudioBlocked(cb: (blocked: boolean) => void): Unsubscribe;
  startAudio(): Promise<void>;
}
