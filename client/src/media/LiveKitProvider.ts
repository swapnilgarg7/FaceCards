import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  VideoQuality,
  type Participant,
  type RoomEventCallbacks,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublication,
} from "livekit-client";
import type {
  Datagram,
  DatagramTopic,
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

/**
 * Size of the hidden elements remote video is attached to.
 *
 * This is not cosmetic, and it is not arbitrary. `adaptiveStream` chooses which
 * simulcast layer to pull by measuring these elements, so their size is the
 * only thing deciding how much resolution an avatar's face gets. At the old
 * 320x180 every remote face arrived as the 180p layer, and since the face crop
 * samples roughly a quarter of the frame and stretches it across the plane,
 * that left about 66x87 real pixels to magnify. That is the blur, and tracked
 * framing made it worse by cropping tighter than the old fixed zoom did.
 *
 * Matched to the capture resolution so the top layer is requested. The face
 * plane renders around 250px tall, and the crop keeps roughly half the frame
 * height, so anything below 540 is being upscaled before it is even drawn.
 */
const SINK_WIDTH = 960;
const SINK_HEIGHT = 540;

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
  sink.style.width = `${SINK_WIDTH}px`;
  sink.style.height = `${SINK_HEIGHT}px`;
  // Zero opacity, not `visibility: hidden` or `display: none`: those last two
  // read as invisible to the intersection observer behind adaptiveStream,
  // which then stops the track entirely rather than downgrading it.
  sink.style.opacity = "0";
  sink.style.pointerEvents = "none";
  sink.style.zIndex = "-1";
  sink.style.overflow = "hidden";
  document.body.appendChild(sink);
  return sink;
}

/**
 * Floor on the gap between two accepted datagrams from one peer, in ms. Three
 * times the intended publish interval of ~83 ms, so a peer that bursts or
 * whose timer drifts is never penalised, and one that floods is.
 */
const MIN_DATAGRAM_INTERVAL_MS = 28;

/** The receive-side half of `DatagramTopic`. Both must be widened together. */
function isKnownTopic(topic: string | undefined): topic is DatagramTopic {
  return topic === "facebox";
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
  private readonly dataListeners: Emitter<
    [string, DatagramTopic, Uint8Array]
  > = new Set();

  /** peerId -> when we last accepted a datagram from them. Rate limiting. */
  private readonly lastDatagramAt = new Map<string, number>();

  private speakingNow = new Set<string>();

  /** So a rejected datagram channel is reported once rather than never. */
  private dataFailureLogged = false;

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

  sendData(topic: DatagramTopic, payload: Datagram): void {
    const room = this.room;
    // Not an error to call this before connecting or after leaving: the
    // tracker publishes on a timer that does not know about room lifecycle.
    if (!room || room.state !== ConnectionState.Connected) return;

    void room.localParticipant
      .publishData(payload, { reliable: false, topic })
      .catch((err: unknown) => {
        // Once, not every time. This fires a dozen times a second, so logging
        // each failure buries the console - but swallowing all of them hides
        // the difference between "a lossy packet was lost", which is this
        // channel working as designed, and "every packet is being rejected",
        // which looks identical from here and is not.
        if (this.dataFailureLogged) return;
        this.dataFailureLogged = true;
        console.error(
          `[media] datagram publish failed on topic "${topic}", and will be ` +
            "reported once. If this is a permissions error, the join token " +
            "is missing the data-publish grant and *no* datagram is reaching " +
            "anyone:",
          err,
        );
      });
  }

  onData(
    cb: (peerId: string, topic: DatagramTopic, payload: Uint8Array) => void,
  ): Unsubscribe {
    return subscribe(this.dataListeners, cb);
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
      .on(RoomEvent.AudioPlaybackStatusChanged, this.handleAudioPlayback)
      .on(RoomEvent.DataReceived, this.handleData);
  }

  /**
   * Typed against the SDK's own callback signature rather than a hand-written
   * one. These are positional arguments: a narrower local signature is
   * structurally assignable, so an SDK upgrade that reorders them would leave
   * `topic` silently undefined, drop every packet at the guard below, and
   * break face tracking with nothing in the console. This way it is a compile
   * error instead.
   */
  private readonly handleData: RoomEventCallbacks["dataReceived"] = (
    payload,
    participant,
    _kind,
    topic,
  ): void => {
    // A packet with no participant came from the server API rather than a
    // peer, and this channel is defined as peer-to-peer presentation state.
    // Nothing upstream should be sending on it; if something starts, it does
    // not get to impersonate a player.
    if (!participant) return;

    // Allow-listed at the boundary, not by the listeners. The join token
    // grants blanket data-publish permission because LiveKit has no per-topic
    // ACL, so this is where an unexpected topic stops: anything a peer invents
    // from devtools is dropped here rather than fanned out to whatever happens
    // to be subscribed.
    if (!isKnownTopic(topic)) return;

    // Rate limited per peer. A hostile client can publish as fast as it likes
    // and the SFU will fan it out to everyone, so without this one peer can
    // spend every other client's main thread on decodes. The intended rate is
    // twelve a second; this caps well above that so ordinary bursts and
    // clock jitter pass untouched.
    const now = performance.now();
    const last = this.lastDatagramAt.get(participant.identity) ?? 0;
    if (now - last < MIN_DATAGRAM_INTERVAL_MS) return;
    this.lastDatagramAt.set(participant.identity, now);

    emit(this.dataListeners, participant.identity, topic, payload);
  };

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
      // Sized explicitly, because adaptiveStream measures the *element*, not
      // its container, and an unstyled <video> reports the CSS default of
      // 300x150 however large the sink around it is. Leaving this off is the
      // same bug as an undersized sink: the top simulcast layer is published
      // and never requested.
      el.style.width = `${SINK_WIDTH}px`;
      el.style.height = `${SINK_HEIGHT}px`;
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
    this.lastDatagramAt.delete(peerId);
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
