import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomSnapshot } from "../net/useRoom.js";
import { AudioEngine } from "./AudioEngine.js";
import { tableCues } from "./cues.js";

/**
 * Table sound as a hook: one engine for the session, driven by the difference
 * between one snapshot and the next.
 *
 * There is no event stream to subscribe to. There is server state, and state
 * that changed, and `cues.ts` turns the second into sounds. That is what stops
 * a chip clink firing twice for one bet, or a deal being missed because two
 * patches were coalesced into one.
 *
 * The volume is remembered exactly the way the look sensitivity is, and for
 * the same reason: a setting that forgets itself on reload is a bug with extra
 * steps.
 */

const VOLUME_KEY = "facecards.sound-volume";
const MUTED_KEY = "facecards.sound-muted";

const DEFAULT_VOLUME = 0.7;

export function loadVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value >= 0 && value <= 1
      ? value
      : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function loadSoundMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

function save(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can throw outright in a private window. The setting still
    // applies for this session, which is the part that matters.
  }
}

export interface UseTableAudio {
  volume: number;
  muted: boolean;
  /** True once the browser has actually let the context run. */
  ready: boolean;
  setVolume(value: number): void;
  setMuted(value: boolean): void;
  /** Play a sound the table did not derive: a peek, a chip picked up. */
  play: AudioEngine["play"];
}

export function useTableAudio(snapshot: RoomSnapshot | null): UseTableAudio {
  const engine = useRef<AudioEngine | null>(null);
  const [volume, setVolumeState] = useState(loadVolume);
  const [muted, setMutedState] = useState(loadSoundMuted);
  const [ready, setReady] = useState(false);

  if (!engine.current) {
    engine.current = new AudioEngine({ volume, muted });
  }

  // Browsers will not start an audio context without a gesture, and Safari is
  // the strict one. Rather than asking for a click, take the first one that
  // happens anyway - and keep listening, because a context can be suspended
  // again when a tab is backgrounded.
  useEffect(() => {
    const current = engine.current;
    if (!current) return;

    let cancelled = false;
    const kick = () => {
      void current.start().then(() => {
        if (!cancelled) setReady(current.running);
      });
    };

    kick();
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
    document.addEventListener("visibilitychange", kick);
    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
      document.removeEventListener("visibilitychange", kick);
    };
  }, []);

  useEffect(() => {
    const current = engine.current;
    return () => current?.dispose();
  }, []);

  const previous = useRef<RoomSnapshot | null>(null);
  useEffect(() => {
    if (!snapshot) {
      previous.current = null;
      return;
    }
    const before = previous.current;
    previous.current = snapshot;
    for (const cue of tableCues(before, snapshot)) {
      engine.current?.play(cue.sound, cue.delayMs, cue.gain);
    }
  }, [snapshot]);

  const setVolume = useCallback((value: number) => {
    setVolumeState(value);
    engine.current?.setVolume(value);
    save(VOLUME_KEY, String(value));
  }, []);

  const setMuted = useCallback((value: boolean) => {
    setMutedState(value);
    engine.current?.setMuted(value);
    save(MUTED_KEY, value ? "1" : "0");
  }, []);

  const play = useCallback<AudioEngine["play"]>((id, delayMs, gain) => {
    engine.current?.play(id, delayMs, gain);
  }, []);

  return { volume, muted, ready, setVolume, setMuted, play };
}
