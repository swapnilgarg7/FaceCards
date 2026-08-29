/**
 * The room underneath the table: a low bed of voices in another part of the
 * bar, synthesised rather than sampled.
 *
 * `docs/ASSET-SOURCES.md` records that no CC0 crowd bed was found, and that the
 * fallback was to layer short chatter clips. Synthesising it is the better
 * answer for the same reason the card atlas is drawn rather than downloaded:
 * a five-second loop of chatter is recognisable as a loop inside a minute, and
 * this is a bed people sit inside for a whole evening. Noise shaped like
 * voices never repeats, costs about a hundred lines, and needs no licence row.
 *
 * The shape: three bands of filtered noise in the range a room of talking
 * people occupies (roughly 250 Hz to 1.6 kHz), each swelling and fading on its
 * own slow, incommensurate cycle - the same trick `SeatedCamera` uses for the
 * idle sway, and for the same reason. It must never resolve into a pattern.
 *
 * It sits very low on purpose. If anyone notices it, it is too loud: the point
 * is that turning it off should make the room feel like a vacuum, not that
 * turning it on should be audible.
 */

export interface Murmur {
  stop(): void;
}

/** Master level of the whole bed. Deliberately near the floor. */
const BED_GAIN = 0.05;

interface Band {
  /** Centre of the band, in Hz. */
  frequency: number;
  q: number;
  gain: number;
  /** Seconds per swell. Chosen not to share a common multiple. */
  period: number;
}

const BANDS: Band[] = [
  { frequency: 280, q: 1.1, gain: 1, period: 11.3 },
  { frequency: 700, q: 1.6, gain: 0.62, period: 17.9 },
  { frequency: 1500, q: 2.2, gain: 0.3, period: 23.7 },
];

/** How long the noise loop is. Long enough that the noise itself never tells. */
const NOISE_SECONDS = 8;

export function startMurmur(
  context: AudioContext,
  destination: AudioNode,
): Murmur {
  const noise = pinkNoise(context, NOISE_SECONDS);

  const bed = context.createGain();
  bed.gain.value = 0;
  bed.connect(destination);
  // Fade in over a couple of seconds. A room that switches on is a room.
  bed.gain.setTargetAtTime(BED_GAIN, context.currentTime, 1.2);

  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [bed];

  for (const band of BANDS) {
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;

    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = band.frequency;
    filter.Q.value = band.q;

    // The swell. An LFO on the band's gain, at a period that shares no common
    // multiple with the others, so the three never come up together twice.
    const gain = context.createGain();
    gain.gain.value = band.gain * 0.55;

    const lfo = context.createOscillator();
    lfo.frequency.value = 1 / band.period;
    const depth = context.createGain();
    depth.gain.value = band.gain * 0.35;
    lfo.connect(depth);
    depth.connect(gain.gain);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(bed);

    // Started at an offset each, so the three bands are not phase-locked to
    // the same point in the same noise buffer.
    source.start(context.currentTime, Math.random() * NOISE_SECONDS);
    lfo.start();

    sources.push(source, lfo);
    nodes.push(filter, gain, depth);
  }

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      bed.gain.setTargetAtTime(0, context.currentTime, 0.3);
      // Let the fade finish before tearing the graph down, or stopping is a
      // click - which is exactly what a bed exists to avoid.
      window.setTimeout(() => {
        for (const source of sources) {
          try {
            source.stop();
          } catch {
            // Already stopped, or the context went away underneath us.
          }
          source.disconnect();
        }
        for (const node of nodes) node.disconnect();
      }, 900);
    },
  };
}

/**
 * A few seconds of pink noise.
 *
 * Pink rather than white because white is a hiss and pink is a room: equal
 * energy per octave puts the weight down where voices live instead of up in
 * the treble. Paul Kellet's economical filter, which is the standard cheap
 * approximation and is far more than accurate enough for something that will
 * be played thirty decibels down.
 */
function pinkNoise(context: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);

  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }

  // The loop point is the one place a noise buffer can betray itself, so the
  // last few milliseconds are cross-faded into the first.
  const blend = Math.min(length, Math.floor(context.sampleRate * 0.05));
  for (let i = 0; i < blend; i++) {
    const t = i / blend;
    const head = data[i]!;
    const tail = data[length - blend + i]!;
    data[i] = head * t + tail * (1 - t);
  }

  return buffer;
}
