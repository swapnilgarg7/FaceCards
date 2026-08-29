import { useEffect, useRef } from "react";

/**
 * How long the seat on the clock has left.
 *
 * A picture of the server's clock, never the clock itself. The server decides
 * what happens when time runs out and does it whether or not this bar has
 * finished draining; nothing here can act, and nothing here is consulted.
 *
 * It counts down `actingMs` from the moment that value arrived, rather than
 * towards a server timestamp - see the note on `PokerState.actingMs`. The
 * server publishes what is *left*, recomputed on every re-arm, so the bar
 * re-syncs downwards whenever the server revises the deadline and can never be
 * talked into showing more time than the seat has. The cost is that it lags by
 * one network hop; the alternative costs a clock-sync protocol to be wrong by
 * however far two machines have drifted.
 *
 * Driven by `requestAnimationFrame` writing to a transform, not by state:
 * sixty React renders a second, over a HUD that sits on top of a 3D scene, is
 * exactly the frame budget this project is trying not to spend. A backgrounded
 * tab stops delivering frames, so the bar freezes there - which is honest, in
 * that a backgrounded tab is also not going to act in time.
 */
export function TurnClock({
  turn,
  actingMs,
  mine,
  label,
}: {
  /** The decision being timed. A change restarts the countdown. */
  turn: number;
  /** Time left on it, in milliseconds. Zero means nobody is on the clock. */
  actingMs: number;
  /** Whose clock it is, which is the difference between urgent and ambient. */
  mine: boolean;
  label: string;
}) {
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fill = fillRef.current;
    if (!fill || actingMs <= 0) return;

    const startedAt = performance.now();
    let frame = 0;

    const tick = () => {
      const left = 1 - (performance.now() - startedAt) / actingMs;
      const clamped = Math.max(0, Math.min(1, left));
      fill.style.transform = `scaleX(${clamped})`;
      // Under a fifth left is where a player needs to notice without reading.
      fill.dataset["low"] = clamped < 0.2 ? "true" : "false";
      if (clamped > 0) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [turn, actingMs]);

  if (actingMs <= 0) return null;

  return (
    <div
      className={`clock${mine ? " clock--mine" : ""}`}
      role="timer"
      aria-label={label}
    >
      <div className="clock__fill" ref={fillRef} />
    </div>
  );
}
