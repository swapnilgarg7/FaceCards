import type { UseMedia } from "../media/useMedia.js";

/**
 * What is wrong with your camera or microphone, and the way back.
 *
 * The phase-6 exit criterion this component exists to satisfy: *every
 * permission denial path is recoverable without a page reload.* Which means
 * the interesting decision here is not what to say, it is **whether to offer a
 * button at all** - and that decision is not made here. `media/faults.ts`
 * classifies the failure and states the recovery verb, this renders it, and
 * the split is what makes "a Retry button never appears where retrying cannot
 * work" a property of a tested pure function rather than of some JSX.
 *
 * It is worth being precise about why that matters. Nothing a page does can
 * turn a denied permission into a granted one - Chrome will not even re-prompt
 * after a hard denial - so a Retry button on a refusal is a button that fails
 * silently every time it is pressed, which is exactly how a person concludes
 * the whole app is broken. The honest answer for that case is a sentence
 * saying where the control actually is, and no button.
 *
 * The same banner serves the lobby's failures and the table's, because they
 * are the same failures: a camera that is busy is a camera that is busy
 * whether you have sat down yet or not.
 */
export function MediaFaultBanner({
  media,
  className = "",
}: {
  media: UseMedia;
  className?: string;
}) {
  const fault = media.fault;
  if (!fault) return null;

  return (
    <div
      className={`banner banner--error banner--action ${className}`.trim()}
      // "alert" for the things that stop you being seen or heard, which is
      // most of them; a screen reader should not have to wait for the next
      // polite moment to mention that somebody's microphone is off.
      role="alert"
    >
      <span>{fault.message}</span>
      {fault.retryable && (
        <button
          className="btn btn--ghost"
          disabled={media.recovering}
          onClick={() => void media.recover()}
        >
          {media.recovering ? "Trying…" : "Retry"}
        </button>
      )}
    </div>
  );
}
