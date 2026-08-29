import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  VideoQuality,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublication,
} from "livekit-client";
import type {
  MediaConnectionState,
  MediaCredentials,
  MediaProvider,
  PublishOptions,
  TrackKind,
  Unsubscribe,
} from "./MediaProvider.js";

/**
 * The only file in the client that imports `livekit-client`. If a second one
 * ever appears, the portability argument in `docs/TECH-DECISIONS.md` is void.
 *
 * Attached elements live in a hidden container rather than being discarded:
 * `adaptiveStream` decides which simulcast layer to pull by watching each
 * video element's size and visibility, so an element that is not in the DOM
 * gets no video at all. Hidden is fine; absent is not.
 */

/** Off-screen but laid out, not `display:none`, and not zero-size. */
function ensureMediaSink(): HTMLElement {
  const existing = document.getElementById("facecards-media-sink");
  if (existing) return existing;

  const sink = document.createElement("div");
  sink.id = "facecards-media-sink";
  sink.setAttribute("aria-hidden", "true");
  sink.style.position = "fixed";
  sink.style.top = "0";
  sink.style.left = "0";
  sink.style.width = "320px";
  sink.style.height = "180px";
  sink.style.opacity = "0";
  sink.style.pointerEvents = "none";
  sink.style.zIndex = "-1";
  sink.style.overflow = "hidden";
  document.body.appendChild(sink);
  return sink;
}

type Emitter<Args extends unknown[]> = Set<(...args: Args) => void>;

function emit<Args extends unknown[]>(set: Emitter<Args>, ...args: Args): void {
  for (const cb of set) {
    try {
      cb(...args);
    } catch (err) {
      console.error("[media] listener threw:", err);
    }
  }
}

function subscribe<Args extends unknown[]>(
  set: Emitter<Args>,
  cb: (...args: Args) => void,
): Unsubscribe {
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}

export class LiveKitProvider implements MediaProvider {
  private room: Room | null = null;
  private localVideoEl: HTMLVideoElement | null = null;

  /** peerId -> attached element, so teardown can detach exactly one. */
  private readonly remoteVideoEls = new Map<string, HTMLVideoElement>();
  private readonly remoteAudioEls = new Map<string, HTMLMediaElement>();

  private readonly videoListeners: Emitter<[string, HTMLVideoElement]> =
    new Set();
  private readonly goneListeners: Emitter<[string]> = new Set();
  private readonly speakingListeners: Emitter<[string, boolean]> = new Set();
  private readonly muteListeners: Emitter<[string, TrackKind, boolean]> =
    new Set();
  private readonly stateListeners: Emitter<[MediaConnectionState]> = new Set();
  private readonly audioBlockedListeners: Emitter<[boolean]> = new Set();

  private speakingNow = new Set<string>();

  /** peerId -> currently muted kinds, so a late subscriber can be replayed. */
  private readonly mutedNow = new Map<string, Set<TrackKind>>();

  async connect(credentials: MediaCredentials): Promise<void> {
    if (this.room) await this.disconnect();

    const room = new Room({
      // Baseline for spec sections 6 and 12: LiveKit watches each attached
      // element's size and visibility and picks the simulcast layer itself.
      adaptiveStream: true,
      // Stop encoding layers nobody is subscribed to.
      dynacast: true,
      publishDefaults: {
        // Without simulcast there are no layers, so adaptiveStream and
        // setQuality both quietly become no-ops.
        simulcast: true,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
      },
      videoCaptureDefaults: {
        // A face cropped onto an avatar head does not need more, and six of
        // these at once is the frame budget the art direction lives inside.
        resolution: VideoPresets.h540.resolution,
      },
    });

    this.room = room;
    this.wireEvents(room);
    emit(this.stateListeners, "connecting");

    await room.connect(credentials.url, credentials.token);
  }

  async disconnect(): Promise<void> {
    const room = this.room;
    this.room = null;
    if (!room) return;

    for (const peerId of [...this.remoteVideoEls.keys()]) {
      this.teardownPeer(peerId);
    }
    this.detachLocalVideo();
    await room.disconnect();
    room.removeAllListeners();
    emit(this.stateListeners, "disconnected");
  }

  async publishLocal(opts: PublishOptions): Promise<void> {
    const room = this.requireRoom();
    // Sequential, not Promise.all: two simultaneous getUserMedia prompts is a
    // reliable way to have a browser drop one of them.
    if (opts.mic) await room.localParticipant.setMicrophoneEnabled(true);
    if (opts.camera) await room.localParticipant.setCameraEnabled(true);
    this.attachLocalVideo();
  }

  async setMuted(kind: TrackKind, muted: boolean): Promise<void> {
    const room = this.requireRoom();
    if (kind === "audio") {
      await room.localParticipant.setMicrophoneEnabled(!muted);
      return;
    }
    await room.localParticipant.setCameraEnabled(!muted);
    if (muted) this.detachLocalVideo();
    else this.attachLocalVideo();
  }

  isMuted(kind: TrackKind): boolean {
    const p = this.room?.localParticipant;
    if (!p) return true;
    return kind === "audio" ? !p.isMicrophoneEnabled : !p.isCameraEnabled;
  }

  getLocalVideo(): HTMLVideoElement | null {
    return this.localVideoEl;
  }

  onRemoteVideo(
    cb: (peerId: string, el: HTMLVideoElement) => void,
  ): Unsubscribe {
    // Replay what is already attached, so a late subscriber (the 3D scene
    // mounting after connect) is not permanently missing existing peers.
    for (const [peerId, el] of this.remoteVideoEls) cb(peerId, el);
    return subscribe(this.videoListeners, cb);
  }

  onRemoteGone(cb: (peerId: string) => void): Unsubscribe {
    return subscribe(this.goneListeners, cb);
  }

  onSpeaking(cb: (peerId: string, speaking: boolean) => void): Unsubscribe {
    return subscribe(this.speakingListeners, cb);
  }

  onRemoteMute(
    cb: (peerId: string, kind: TrackKind, muted: boolean) => void,
  ): Unsubscribe {
    // Replay, for the same reason onRemoteVideo replays: the scene mounts
    // after connect, and a peer who muted before then would otherwise show a
    // live face plane over a dead track until they toggled it again.
    for (const [peerId, kinds] of this.mutedNow) {
      for (const kind of kinds) cb(peerId, kind, true);
    }
    return subscribe(this.muteListeners, cb);
  }

  onConnectionState(cb: (state: MediaConnectionState) => void): Unsubscribe {
    return subscribe(this.stateListeners, cb);
  }

  onAudioBlocked(cb: (blocked: boolean) => void): Unsubscribe {
    return subscribe(this.audioBlockedListeners, cb);
  }

  async startAudio(): Promise<void> {
    await this.room?.startAudio();
  }

  setQuality(peerId: string, q: "high" | "medium" | "low"): void {
    const participant = this.room?.remoteParticipants.get(peerId);
    if (!participant) return;

    const quality =
      q === "high"
        ? VideoQuality.HIGH
        : q === "medium"
          ? VideoQuality.MEDIUM
          : VideoQuality.LOW;

    for (const publication of participant.videoTrackPublications.values()) {
      publication.setVideoQuality(quality);
    }
  }

  // ---- internals ----------------------------------------------------------

  private requireRoom(): Room {
    if (!this.room) throw new Error("MediaProvider is not connected");
    return this.room;
  }

  private wireEvents(room: Room): void {
    room
      .on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, this.handleTrackUnsubscribed)
      .on(RoomEvent.ParticipantDisconnected, this.handleParticipantGone)
      .on(RoomEvent.ActiveSpeakersChanged, this.handleActiveSpeakers)
      .on(RoomEvent.TrackMuted, this.handleTrackMuted)
      .on(RoomEvent.TrackUnmuted, this.handleTrackUnmuted)
      .on(RoomEvent.ConnectionStateChanged, this.handleConnectionState)
      .on(RoomEvent.AudioPlaybackStatusChanged, this.handleAudioPlayback);
  }

  private readonly handleTrackSubscribed = (
    track: RemoteTrack,
    _publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void => {
    const peerId = participant.identity;

    if (track.kind === Track.Kind.Video) {
      // attach() is mandatory, not a convenience: reading the raw MediaStream
      // bypasses adaptive-stream negotiation entirely.
      const el = track.attach() as HTMLVideoElement;
      el.dataset["peerId"] = peerId;
      // attach() sets these already; setting them again costs nothing and
      // documents that autoplay depends on them.
      el.muted = true;
      el.playsInline = true;
      ensureMediaSink().appendChild(el);

      this.remoteVideoEls.get(peerId)?.remove();
      this.remoteVideoEls.set(peerId, el);
      emit(this.videoListeners, peerId, el);
      return;
    }

    if (track.kind === Track.Kind.Audio) {
      // Audio is plain DOM playback and never becomes a texture, so it is
      // handled entirely inside this boundary.
      const el = track.attach();
      ensureMediaSink().appendChild(el);
      this.remoteAudioEls.get(peerId)?.remove();
      this.remoteAudioEls.set(peerId, el);
    }
  };

  private readonly handleTrackUnsubscribed = (
    track: RemoteTrack,
    _publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void => {
    const peerId = participant.identity;
    // Detach every element this track owns, then drop ours. A leaked video
    // element becomes a leaked VideoTexture in phase 1, which eats VRAM within
    // minutes of people cycling in and out.
    for (const el of track.detach()) el.remove();

    if (track.kind === Track.Kind.Video) {
      this.remoteVideoEls.delete(peerId);
      emit(this.goneListeners, peerId);
    } else if (track.kind === Track.Kind.Audio) {
      this.remoteAudioEls.delete(peerId);
    }
  };

  private readonly handleParticipantGone = (
    participant: RemoteParticipant,
  ): void => {
    this.teardownPeer(participant.identity);
  };

  private teardownPeer(peerId: string): void {
    const video = this.remoteVideoEls.get(peerId);
    if (video) {
      video.srcObject = null;
      video.remove();
      this.remoteVideoEls.delete(peerId);
    }
    const audio = this.remoteAudioEls.get(peerId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      this.remoteAudioEls.delete(peerId);
    }
    if (this.speakingNow.delete(peerId)) {
      emit(this.speakingListeners, peerId, false);
    }
    // Clear mute state too, or a peer who left muted comes back muted after
    // rejoining with a live track.
    const muted = this.mutedNow.get(peerId);
    if (muted) {
      for (const kind of muted) emit(this.muteListeners, peerId, kind, false);
      this.mutedNow.delete(peerId);
    }
    emit(this.goneListeners, peerId);
  }

  private readonly handleActiveSpeakers = (
    speakers: { identity: string }[],
  ): void => {
    const next = new Set(speakers.map((s) => s.identity));
    for (const id of this.speakingNow) {
      if (!next.has(id)) emit(this.speakingListeners, id, false);
    }
    for (const id of next) {
      if (!this.speakingNow.has(id)) emit(this.speakingListeners, id, true);
    }
    this.speakingNow = next;
  };

  private readonly handleTrackMuted = (
    publication: TrackPublication,
    participant: Participant,
  ): void => {
    this.setRemoteMute(publication, participant, true);
  };

  private readonly handleTrackUnmuted = (
    publication: TrackPublication,
    participant: Participant,
  ): void => {
    this.setRemoteMute(publication, participant, false);
  };

  private setRemoteMute(
    publication: TrackPublication,
    participant: Participant,
    muted: boolean,
  ): void {
    // The local participant's own mute state is already owned by the UI that
    // toggled it, and reporting it here would make "remote" a lie.
    if (participant.identity === this.room?.localParticipant.identity) return;

    const kind: TrackKind | null =
      publication.kind === Track.Kind.Video
        ? "video"
        : publication.kind === Track.Kind.Audio
          ? "audio"
          : null;
    if (!kind) return;

    const peerId = participant.identity;
    let kinds = this.mutedNow.get(peerId);
    if (!kinds) {
      kinds = new Set();
      this.mutedNow.set(peerId, kinds);
    }
    if (muted ? kinds.has(kind) : !kinds.has(kind)) return;
    if (muted) kinds.add(kind);
    else kinds.delete(kind);

    emit(this.muteListeners, peerId, kind, muted);
  }

  private readonly handleConnectionState = (state: ConnectionState): void => {
    const mapped: Record<ConnectionState, MediaConnectionState> = {
      [ConnectionState.Disconnected]: "disconnected",
      [ConnectionState.Connecting]: "connecting",
      [ConnectionState.Connected]: "connected",
      [ConnectionState.Reconnecting]: "reconnecting",
      [ConnectionState.SignalReconnecting]: "reconnecting",
    };
    emit(this.stateListeners, mapped[state] ?? "failed");
  };

  private readonly handleAudioPlayback = (): void => {
    emit(this.audioBlockedListeners, this.room?.canPlaybackAudio === false);
  };

  private attachLocalVideo(): void {
    const publication = this.room?.localParticipant.getTrackPublication(
      Track.Source.Camera,
    );
    const track = publication?.videoTrack;
    if (!track) return;

    this.detachLocalVideo();
    const el = track.attach() as HTMLVideoElement;
    el.muted = true;
    el.playsInline = true;
    ensureMediaSink().appendChild(el);
    this.localVideoEl = el;
  }

  private detachLocalVideo(): void {
    if (!this.localVideoEl) return;
    this.localVideoEl.srcObject = null;
    this.localVideoEl.remove();
    this.localVideoEl = null;
  }
}
