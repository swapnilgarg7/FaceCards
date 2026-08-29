import { wakeSecondsLeft, type WakeStatus } from "../net/wake.js";

/**
 * A minute of waiting, narrated.
 *
 * Deliberately a banner and not a modal: the lobby underneath stays usable
 * while this is up, because the whole point is that someone spends the boot
 * filling in their name rather than watching a spinner. Blocking the form
 * would trade a hidden wait for a visible one and save nobody any time.
 */
export function ServerWaking({ status }: { status: WakeStatus }) {
  if (status.kind === "idle") return null;

  if (status.kind === "failed") {
    return <p className="note note--error">{status.message}</p>;
  }

  const percent = Math.round(status.fraction * 100);
  const left = wakeSecondsLeft(status.elapsedMs, status.estimateMs);

  return (
    <section className="waking" aria-live="polite">
      <div className="waking__row">
        <span className="waking__pulse" aria-hidden="true" />
        <span className="waking__title">Waking the table</span>
        <span className="waking__eta">
          {status.overdue ? "almost there" : `~${left}s`}
        </span>
      </div>

      <div
        className="waking__track"
        role="progressbar"
        aria-label="Server starting up"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="waking__fill" style={{ width: `${percent}%` }} />
      </div>

      <p className="note">
        {status.overdue
          ? "Taking a little longer than usual. Still trying."
          : "The table server naps when nobody is playing. Carry on filling this in - it will be up by the time you sit down."}
      </p>
    </section>
  );
}
