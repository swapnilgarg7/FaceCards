import { useEffect, useRef } from "react";

/**
 * Mounts an already-attached media element into the layout.
 *
 * The element is created and owned by the media provider; this component only
 * moves it into a visible box. That matters for more than tidiness:
 * `adaptiveStream` picks a simulcast layer from the element's rendered size
 * and visibility, so an element parked off-screen stays on the lowest layer.
 * Putting it where the user actually sees it is what upgrades the quality.
 *
 * Phase 1 replaces this component with a face plane, and the element it is
 * handed does not change.
 */
export function VideoTile({
  el,
  label,
  mirrored = false,
  speaking = false,
  muted = false,
  cameraOff = false,
}: {
  el: HTMLVideoElement | null;
  label: string;
  mirrored?: boolean;
  speaking?: boolean;
  muted?: boolean;
  cameraOff?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !el) return;

    el.style.width = "100%";
    el.style.height = "100%";
    el.style.objectFit = "cover";
    el.style.display = "block";
    // Your own image should mirror, because that is what a mirror does and
    // what everyone expects of themselves. Other people's must not.
    el.style.transform = mirrored ? "scaleX(-1)" : "none";
    host.appendChild(el);

    return () => {
      // Hand it back to the provider's sink rather than destroying it: the
      // provider owns the element's life, and detaching it from the DOM
      // entirely would stop adaptive streaming.
      const sink = document.getElementById("facecards-media-sink");
      if (sink && el.parentElement === host) sink.appendChild(el);
    };
  }, [el, mirrored]);

  return (
    <figure className={`tile${speaking ? " tile--speaking" : ""}`}>
      <div className="tile__video" ref={hostRef}>
        {(!el || cameraOff) && <div className="tile__placeholder">camera off</div>}
      </div>
      <figcaption className="tile__label">
        {muted && <span aria-label="muted">muted</span>}
        <span>{label}</span>
      </figcaption>
    </figure>
  );
}
