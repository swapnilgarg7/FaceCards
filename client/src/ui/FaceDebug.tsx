import { useEffect, useState } from "react";
import type { FaceTrackingStatus } from "../avatars/useFaceTracking.js";
import type { UseMedia } from "../media/useMedia.js";

/**
 * Dev-only readout for the face pipeline.
 *
 * This exists because face framing has three places to fail that all look
 * identical from the outside - the detector never starts, the box never
 * arrives, or the box arrives and the source video is too small to crop - and
 * guessing between them from a screenshot wastes an afternoon per guess.
 *
 * The numbers that matter:
 *
 * - `local` is this machine's tracker. `running 12/s` means it is detecting.
 *   `no face` means it is detecting and sees nobody.
 * - Per peer, the resolution is the *source* the crop samples from. It is the
 *   simulcast layer `adaptiveStream` chose, and it is chosen from the size of
 *   the hidden element in `LiveKitProvider`'s media sink. If it reads 320x180
 *   the face is being magnified out of a postage stamp and no amount of
 *   framing will make it sharp.
 * - `box` is their framing, and the rate is how fast it is arriving. `--`
 *   means nothing is coming and that avatar is on the fixed fallback crop.
 *
 * Polls a couple of times a second rather than subscribing, so it costs two
 * renders a second and never touches the frame loop.
 */

const POLL_MS = 500;

function fmt(n: number): string {
  return n.toFixed(2);
}

export function FaceDebug({
  media,
  tracking,
}: {
  media: UseMedia;
  tracking: FaceTrackingStatus;
}) {
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), POLL_MS);
    return () => clearInterval(id);
  }, []);

  const stats = media.faceBoxes.stats();
  const byPeer = new Map(stats.map((s) => [s.peerId, s]));

  const local = tracking.lastBox;

  return (
    <div className="facedebug">
      <div className="facedebug__row">
        <b>local</b> {tracking.state}
        {tracking.state === "running" && ` ${tracking.rate}/s`}
        {tracking.reason && ` (${tracking.reason})`}
        {tracking.state === "running" &&
          (local
            ? ` box ${fmt(local.cx)},${fmt(local.cy)} h${fmt(local.h)}`
            : " no face")}
      </div>

      {[...media.remotes].map(([peerId, el]) => {
        const stat = byPeer.get(peerId);
        const w = el.videoWidth;
        const h = el.videoHeight;
        // The number this whole overlay was built to surface.
        const starved = w > 0 && h < 400;
        return (
          <div className="facedebug__row" key={peerId}>
            <b>{peerId.slice(0, 6)}</b>{" "}
            <span className={starved ? "facedebug__warn" : undefined}>
              {w}x{h}
            </span>{" "}
            {stat?.box
              ? `box ${fmt(stat.box.cx)},${fmt(stat.box.cy)} h${fmt(
                  stat.box.h,
                )} ${stat.rate}/s`
              : "-- no box, fixed crop"}
          </div>
        );
      })}
    </div>
  );
}
