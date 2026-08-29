import { SOUND_DIR, SOUNDS, soundFiles, type SoundId } from "./sounds.js";
import { startMurmur, type Murmur } from "./murmur.js";

/**
 * The table's own sound: decode once, play many, and a room bed underneath.
 *
 * Deliberately its own `AudioContext`, separate from LiveKit's. The voice path
 * is the product and must not share a graph with foley: a table sound that
 * glitched would take everyone's voices with it, and LiveKit owns its own
 * element playback and echo cancellation.
 *
 * Everything is decoded up front into `AudioBuffer`s and played through
 * throwaway `AudioBufferSourceNode`s, which is the only shape that survives a
 * deal firing six clicks in half a second: an `<audio>` element per sound
 * cannot overlap itself, and creating one per click leaks elements.
 *
 * Browsers refuse to start an `AudioContext` without a gesture, and Safari is
 * the strict one. `resume()` is therefore called from a real click rather than
 * on construction, and until it lands the whole engine is silent rather than
 * throwing - see `useTableAudio`.
 */

/** Ceiling on simultaneous voices, so a pathological burst cannot pile up. */
const MAX_VOICES = 12;

export interface AudioEngineOptions {
  /** 0..1, the listener's own volume. */
  volume?: number;
  muted?: boolean;
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private voices = 0;
  private murmur: Murmur | null = null;
  private loading: Promise<void> | null = null;
  private disposed = false;

  private volume: number;
  private muted: boolean;

  constructor(options: AudioEngineOptions = {}) {
    this.volume = options.volume ?? 0.7;
    this.muted = options.muted ?? false;
  }

  /** True once the context is running and sound will actually be heard. */
  get running(): boolean {
    return this.context?.state === "running";
  }

  /**
   * Start, or resume after the browser suspended us. Safe to call repeatedly;
   * it is wired to every early click for exactly that reason.
   */
  async start(): Promise<void> {
    if (this.disposed) return;

    if (!this.context) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.context.destination);
    }

    if (this.context.state === "suspended") {
      try {
        await this.context.resume();
      } catch {
        // A resume that is refused is not an error worth surfacing: the next
        // click tries again, and the table is perfectly playable in silence.
        return;
      }
    }

    await this.load();

    if (!this.murmur && this.context && this.master && !this.disposed) {
      this.murmur = startMurmur(this.context, this.master);
    }
  }

  private load(): Promise<void> {
    if (this.loading) return this.loading;
    const context = this.context;
    if (!context) return Promise.resolve();

    this.loading = Promise.all(
      soundFiles().map(async (file) => {
        try {
          const response = await fetch(`${SOUND_DIR}/${file}`);
          if (!response.ok) return;
          const bytes = await response.arrayBuffer();
          const buffer = await context.decodeAudioData(bytes);
          this.buffers.set(file, buffer);
        } catch {
          // One sound that will not decode - an older Safari without Ogg
          // Vorbis, say - costs that sound and nothing else. The table keeps
          // its other twenty-three.
        }
      }),
    ).then(() => undefined);

    return this.loading;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  private applyGain(): void {
    const context = this.context;
    if (!this.master || !context) return;
    const target = this.muted ? 0 : this.volume;
    // Ramped, because a step change on a gain node is an audible click, which
    // is a strange thing to hear when muting.
    this.master.gain.setTargetAtTime(target, context.currentTime, 0.02);
  }

  /**
   * Play `id` in `delayMs`.
   *
   * Scheduled on the audio clock rather than with `setTimeout`, so a deal
   * stays in time through a frame the main thread spent decoding video.
   */
  play(id: SoundId, delayMs = 0, gain = 1): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || context.state !== "running") return;
    if (this.muted || this.voices >= MAX_VOICES) return;

    const spec = SOUNDS[id];
    const file = spec.files[Math.floor(Math.random() * spec.files.length)];
    const buffer = file ? this.buffers.get(file) : undefined;
    if (!buffer) return;

    const source = context.createBufferSource();
    source.buffer = buffer;
    if (spec.detune) {
      // A hair of pitch either way. The ear stops hearing "the same file
      // again" long before it starts hearing a pitch change.
      source.playbackRate.value = 1 + (Math.random() * 2 - 1) * spec.detune;
    }

    const node = context.createGain();
    node.gain.value = spec.gain * gain;

    source.connect(node);
    node.connect(master);

    this.voices++;
    source.onended = () => {
      this.voices--;
      source.disconnect();
      node.disconnect();
    };
    source.start(context.currentTime + Math.max(0, delayMs) / 1000);
  }

  dispose(): void {
    this.disposed = true;
    this.murmur?.stop();
    this.murmur = null;
    this.buffers.clear();
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
  }
}
