import {
  AudioPresets,
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
 * The top of the simulcast ladder: capture resolution, and the most a single
 * face can ever cost.
 *
 * Named once because three things have to agree about it and drift silently if
 * they do not - what the camera captures, what the top rung of
 * `videoSimulcastLayers` is, and how big the sink elements are. An h540
 * capture behind a 640x360 sink is not a saving; it is an encode nobody
 * subscribes to, which `dynacast` eventually turns off and pays for until it
 * does.
 */
const CAPTURE = VideoPresets.h360;

/**
 * Size of the hidden elements remote video is attached to.
 *
 * This is not cosmetic, and it is not arbitrary. `adaptiveStream` chooses which
 * simulcast layer to pull by measuring these elements, so their size is the
 * only thing deciding how much resolution an avatar's face gets. At 320x180
 * every remote face arrived as the 180p layer, and since the face crop samples
 * roughly a quarter of the frame and stretches it across the plane, that left
 * about 66x87 real pixels to magnify. That is the blur, and tracked framing
 * made it worse by cropping tighter than the old fixed zoom did.
 *
 * Matched to `CAPTURE`, so the top layer is what a face you are looking at
 * gets. It was 960x540 to match an h540 capture, and that is the single most
 * expensive line this file ever had: it asked the SFU for 800 kbps per remote,
 * for every remote, because every element in the sink is the same size and
 * `adaptiveStream` had no reason to send less. Eight people at a table was
 * about 2.5 Mbps of downstream each and roughly 9 GB an hour off the LiveKit
 * bill for one room. The face plane renders around 250px tall and the crop
 * keeps roughly half the frame height, so 360 gives ~180px for a 250px plane -
 * a mild upscale you have to be looking for, at less than half the bitrate.
 */
const SINK_WIDTH = CAPTURE.width;
const SINK_HEIGHT = CAPTURE.height;

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
  // One cell, and every element placed in it, so that they stack rather than
  // queue. **This is load-bearing.** In normal flow the second element sat
  // below the first, outside a box that is exactly one element tall and clips
  // its overflow - so the intersection observer behind adaptiveStream reported
  // it as invisible, LiveKit told the SFU to pause that track, and the second
  // face anyone met froze on its first frame while the first face was fine.
  // With every child in the same cell, an eighth peer is as visible as the
  // first. See `stackInSink` for the other half of it.
  sink.style.display = "grid";
  sink.style.gridTemplateRows = "1fr";
  sink.style.gridTemplateColumns = "1fr";
  document.body.appendChild(sink);
  return sink;
}

/**
 * Put an element in the sink's single cell, at the size adaptiveStream is
 * meant to measure.
 *
 * `gridArea` is inert anywhere else, so this survives `ui/VideoTile.tsx`
 * borrowing the local element for the self-view and handing it back.
 */
function stackInSink(el: HTMLElement): void {
  el.style.gridArea = "1 / 1";
  el.style.width = `${SINK_WIDTH}px`;
  el.style.height = `${SINK_HEIGHT}px`;
  ensureMediaSink().appendChild(el);
}

/**
 * How often to check that every remote element is still playing.
 *
 * A paused `<video>` is the third way a face freezes, after a paused track and
 * a texture nobody uploads, and it happens for reasons outside this code:
 * a media element that loses its source mid-swap, a tab restored from the
 * back/forward cache, a browser that declines to resume after the machine
 * wakes. `play()` on an element that is already playing is a no-op, so the
 * cheapest fix is to keep asking.
 */
const PLAYBACK_WATCHDOG_MS = 2000;

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
  private readonly localEndedListeners: Emitter<[TrackKind]> = new Set();
  private readonly deviceErrorListeners: Emitter<[unknown, TrackKind | null]> =
    new Set();
  /**
   * Cleanup for the `ended` listeners attached to the underlying
   * `MediaStreamTrack`s. Held rather than left to the collector because a
   * session that toggles its camera a dozen times publishes a dozen tracks,
   * and a listener per dead track is a listener that fires on nothing forever.
   */
  private readonly localTrackCleanup = new Map<TrackKind, () => void>();
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

  /** Keeps remote elements playing. Runs only while connected. */
  private playbackWatchdog: ReturnType<typeof setInterval> | null = null;

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
        // The ladder `scene/attention.ts` spends. Three rungs, because that
        // module has exactly three levels: the face you are turned towards
        // gets `CAPTURE`, faces in your peripheral vision get h180, and faces
        // behind you get h90. Keep it at three - drop one and two of those
        // levels silently collapse onto the same layer, which is how you end
        // up paying peripheral prices for seats nobody can see.
        //
        // h90 is the floor and the one thing here worth watching: at 160x90 a
        // face is ~80x45 real pixels after the crop. That is fine for a head
        // you are not looking at and would be poor if it were ever the level
        // you rest on, which is what `HIGH_ANGLE`/`MEDIUM_ANGLE` and their
        // hysteresis exist to prevent. If distant seats read as smears rather
        // than as people, raise this rung before touching anything else.
        videoSimulcastLayers: [VideoPresets.h90, VideoPresets.h180],
        // Voice at a card table, not music. The SDK's default is
        // `AudioPresets.music` at 48 kbps, which is twice what speech needs
        // and is paid per subscriber per speaker. DTX and RED stay on at
        // their defaults: silence is already nearly free, and the redundancy
        // is what keeps a dropped packet from clipping a word.
        audioPreset: AudioPresets.speech,
      },
      videoCaptureDefaults: {
        // A face cropped onto an avatar head does not need more, and eight of
        // these at once is the frame budget the art direction lives inside.
        // This is also the top simulcast rung, so it is the ceiling on what a
        // face you are looking directly at can cost.
        resolution: CAPTURE.resolution,
      },
    });

    this.room = room;
    this.wireEvents(room);
    this.playbackWatchdog ??= setInterval(
      this.nudgePlayback,
      PLAYBACK_WATCHDOG_MS,
    );
    emit(this.stateListeners, "connecting");

    await room.connect(credentials.url, credentials.token);
  }

  async disconnect(): Promise<void> {
    const room = this.room;
    this.room = null;
    if (this.playbackWatchdog !== null) {
      clearInterval(this.playbackWatchdog);
      this.playbackWatchdog = null;
    }
    if (!room) return;

    for (const peerId of [...this.remoteVideoEls.keys()]) {
      this.teardownPeer(peerId);
    }
    for (const cleanup of this.localTrackCleanup.values()) cleanup();
    this.localTrackCleanup.clear();
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

  async restartLocal(opts: PublishOptions): Promise<void> {
    const room = this.requireRoom();
    // Down to zero first. After a device is unplugged the publication is still
    // there holding a dead `MediaStreamTrack`, and asking to enable a track the
    // SDK already believes is enabled is a no-op - so a recovery that only
    // called `setCameraEnabled(true)` would appear to succeed and change
    // nothing. The disable is the half that does the work.
    if (opts.mic) await room.localParticipant.setMicrophoneEnabled(false);
    if (opts.camera) {
      await room.localParticipant.setCameraEnabled(false);
      this.detachLocalVideo();
    }
    // Sequential for the same reason `publishLocal` is: two simultaneous
    // `getUserMedia` prompts is a reliable way to have a browser drop one.
    if (opts.mic) await room.localParticipant.setMicrophoneEnabled(true);
    if (opts.camera) await room.localParticipant.setCameraEnabled(true);
    this.attachLocalVideo();
  }

  isMuted(kind: TrackKind): boolean {
    const p = this.room?.localParticipant;
    if (!p) return true;
    return kind === "audio" ? !p.isMicrophoneEnabled : !p.isCameraEnabled;
  }

  onLocalTrackEnded(cb: (kind: TrackKind) => void): Unsubscribe {
    return subscribe(this.localEndedListeners, cb);
  }

  onDeviceError(
    cb: (error: unknown, kind: TrackKind | null) => void,
  ): Unsubscribe {
    return subscribe(this.deviceErrorListeners, cb);
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

  /**
   * Restart any remote element that has stopped.
   *
   * Video only. A silent audio element is the autoplay-blocked case, which has
   * its own banner and needs a real user gesture; retrying it here would do
   * nothing except bury the console in rejected promises.
   */
  private readonly nudgePlayback = (): void => {
    for (const el of this.remoteVideoEls.values()) {
      if (!el.paused || !el.srcObject) continue;
      void el.play().catch(() => {
        // Nothing to do about it, and it is retried in two seconds anyway.
      });
    }
  };

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
      .on(RoomEvent.DataReceived, this.handleData)
      .on(RoomEvent.LocalTrackPublished, this.handleLocalTrackPublished)
      .on(RoomEvent.MediaDevicesError, this.handleDeviceError);
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
      // Built, sized and mounted *before* attach(), which is the opposite of
      // the obvious order and the reason a face used to arrive frozen.
      // attach() measures the element on the spot to decide a simulcast layer
      // and whether the track is visible at all; an element that is not in the
      // document yet has no box, reads as invisible, and LiveKit answers by
      // telling the SFU to pause the track before the first frame has landed.
      // It recovers when the intersection observer next runs, but there is no
      // reason to ask for a pause we immediately have to undo.
      //
      // attach() itself is still mandatory rather than a convenience: reading
      // the raw MediaStream bypasses adaptive-stream negotiation entirely.
      const el = document.createElement("video");
      el.dataset["peerId"] = peerId;
      // Which *session* this element belongs to. A player who drops and
      // reconnects comes back under the same identity, so identity alone
      // cannot tell their new element from their old one - see
      // `handleParticipantGone`.
      el.dataset["participantSid"] = participant.sid;
      // attach() sets these too; setting them here means they are true before
      // the element has a source, and documents that autoplay depends on them.
      el.muted = true;
      el.playsInline = true;
      // Sized explicitly, because adaptiveStream measures the *element*, not
      // its container, and an unstyled <video> reports the CSS default of
      // 300x150 however large the sink around it is. Leaving this off is the
      // same bug as an undersized sink: the top simulcast layer is published
      // and never requested.
      stackInSink(el);
      track.attach(el);

      this.remoteVideoEls.get(peerId)?.remove();
      this.remoteVideoEls.set(peerId, el);
      emit(this.videoListeners, peerId, el);
      return;
    }

    if (track.kind === Track.Kind.Audio) {
      // Audio is plain DOM playback and never becomes a texture, so it is
      // handled entirely inside this boundary.
      const el = track.attach();
      el.dataset["participantSid"] = participant.sid;
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
    const detached = track.detach();
    for (const el of detached) el.remove();

    // Only clear the seat if what we are holding is one of the elements this
    // track just took with it. An unsubscribe for a stale track can land after
    // the same player's new one has been subscribed - a reconnect, or a camera
    // toggled off and on - and deleting by identity alone would throw away the
    // element that is currently working and leave the avatar blank for good.
    if (track.kind === Track.Kind.Video) {
      const current = this.remoteVideoEls.get(peerId);
      if (current && !detached.includes(current)) return;
      this.remoteVideoEls.delete(peerId);
      emit(this.goneListeners, peerId);
    } else if (track.kind === Track.Kind.Audio) {
      const current = this.remoteAudioEls.get(peerId);
      if (current && !detached.includes(current)) return;
      this.remoteAudioEls.delete(peerId);
    }
  };

  private readonly handleParticipantGone = (
    participant: RemoteParticipant,
  ): void => {
    // Same trap as above, one level up. A player who drops and reconnects
    // rejoins under the same identity, and LiveKit replaces the participant
    // rather than adding one, so the disconnect for the session that ended can
    // arrive *after* the replacement's tracks have been subscribed. Tearing
    // down on identity alone would then null the source of the element that
    // had just started playing, and that seat stays empty until they leave and
    // come back again - which is the whole bug, seen from the other side of
    // the table.
    const video = this.remoteVideoEls.get(participant.identity);
    const audio = this.remoteAudioEls.get(participant.identity);
    const held =
      video?.dataset["participantSid"] ?? audio?.dataset["participantSid"];
    if (held !== undefined && held !== participant.sid) return;

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

  /**
   * Watch a freshly published local track for the device going away.
   *
   * Listens to the *platform* `ended` event on the underlying
   * `MediaStreamTrack` rather than to an SDK event, and that is the point:
   * `ended` is the browser's own statement that the source is gone for good,
   * it fires for every cause (unplugged, claimed by another app, revoked at
   * the OS level), and it does not depend on a vendor's event taxonomy staying
   * put across a major version. Nothing throws when this happens, which is why
   * the symptom without it is a still photograph of somebody who is still
   * talking.
   */
  private readonly handleLocalTrackPublished: RoomEventCallbacks["localTrackPublished"] =
    (publication): void => {
      const kind: TrackKind =
        publication.kind === Track.Kind.Audio ? "audio" : "video";
      const mediaTrack = publication.track?.mediaStreamTrack;
      if (!mediaTrack) return;

      // A session that toggles its camera a dozen times publishes a dozen
      // tracks. Drop the previous watcher before taking the new one.
      this.localTrackCleanup.get(kind)?.();

      const onEnded = (): void => {
        this.localTrackCleanup.delete(kind);
        emit(this.localEndedListeners, kind);
      };
      mediaTrack.addEventListener("ended", onEnded);
      this.localTrackCleanup.set(kind, () =>
        mediaTrack.removeEventListener("ended", onEnded),
      );
    };

  private readonly handleDeviceError: RoomEventCallbacks["mediaDevicesError"] =
    (error, kind): void => {
      const track: TrackKind | null =
        kind === "videoinput" ? "video" : kind === "audioinput" ? "audio" : null;
      emit(this.deviceErrorListeners, error, track);
    };

  private attachLocalVideo(): void {
    const publication = this.room?.localParticipant.getTrackPublication(
      Track.Source.Camera,
    );
    const track = publication?.videoTrack;
    if (!track) return;

    this.detachLocalVideo();
    // Mounted before attach and stacked in the sink's one cell for the same
    // reasons as a remote element. Nothing negotiates a layer for our own
    // camera, but an element sitting in the flow displaces every remote one
    // below it and out of the clip, which is exactly the bug `stackInSink`
    // exists to stop.
    const el = document.createElement("video");
    el.muted = true;
    el.playsInline = true;
    stackInSink(el);
    track.attach(el);
    this.localVideoEl = el;
  }

  private detachLocalVideo(): void {
    if (!this.localVideoEl) return;
    this.localVideoEl.srcObject = null;
    this.localVideoEl.remove();
    this.localVideoEl = null;
  }
}
