import { useCallback, useEffect, useRef, useState } from "react";
import { TablePhase } from "@facecards/shared";
import type { UseMedia } from "../media/useMedia.js";
import type { RoomSnapshot } from "../net/useRoom.js";
import { captureFace, releaseShot, type Shot } from "./capture.js";
import {
  NO_CAPTIONS,
  pickCaption,
  type CaptionMemory,
} from "./captions.js";
import {
  planMoment,
  type MomentPerson,
  type MomentPlan,
  type Treatment,
} from "./moment.js";
import { momentSeed, seededRandom } from "./seed.js";
import {
  addToReel,
  shotsOf,
  type ReelEntry,
  type ReelFace,
} from "./reel.js";

/**
 * Poker Moments, wired to a real table.
 *
 * Everything that decides anything is somewhere else - `moment.ts` decides
 * whether a hand is worth photographing and who is in it, `captions.ts`
 * decides what it says, `capture.ts` decides whether a frame is usable. This
 * file owns the three things that cannot be pure: *when* to take the picture,
 * the video elements to take it from, and the object URLs that have to be
 * given back.
 *
 * The one rule that outranks the feature: **a Poker Moment may never affect a
 * hand of poker.** Every capture path returns null rather than throwing, the
 * whole build is wrapped so an unexpected failure cannot escape into the
 * render tree, and there is no state here that the table reads. If this hook
 * were deleted mid-hand the game would carry on exactly as it was.
 */

export interface UseMoments {
  /** The moment on screen, or null. */
  current: LiveMoment | null;
  /** Everything captured this session, most recent last. */
  reel: ReelEntry[];
  /** Take the picture. Call once, when the result is revealed. */
  capture(snapshot: RoomSnapshot): void;
  /** Dismiss the moment on screen. */
  dismiss(): void;
  /** Whether the player wants this feature at all. */
  enabled: boolean;
  setEnabled(enabled: boolean): void;
}

/** A planned moment with the photographs actually taken. */
export interface LiveMoment {
  plan: MomentPlan;
  hero: ReelFace;
  fallen: ReelFace[];
  witnesses: ReelFace[];
}

const ENABLED_KEY = "facecards.moments";

export function loadMomentsEnabled(): boolean {
  try {
    // Absent means on. The feature is the reason somebody would show this
    // product to their friends, and a preference only exists once it has been
    // expressed - but it is one click away in the settings panel, because a
    // camera pointed at your face at the worst moment of your evening is
    // exactly the kind of thing a person is allowed to say no to.
    return window.localStorage.getItem(ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

function saveMomentsEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(ENABLED_KEY, String(enabled));
  } catch {
    // The choice still holds for this session, which is the part that matters.
  }
}

export function useMoments(media: UseMedia, sessionId: string | null): UseMoments {
  const [enabled, setEnabledState] = useState(loadMomentsEnabled);
  const [current, setCurrent] = useState<LiveMoment | null>(null);
  const [reel, setReel] = useState<ReelEntry[]>([]);

  /**
   * What has already been said, and what the last card looked like.
   *
   * Refs, not state: they are read inside an async capture and written on the
   * way out of it, and neither is anything to re-render over. Threading them
   * through as state would also mean a capture that started before a render
   * read a stale memory and repeated a caption.
   */
  const captions = useRef<CaptionMemory>(NO_CAPTIONS);
  const lastTreatment = useRef<Treatment | null>(null);
  /** The hand a moment has already been taken for. Makes `capture` idempotent. */
  const capturedHand = useRef<number>(-1);
  /** Live moment's entry, so a dismiss can revoke exactly what it owns. */
  const showing = useRef<ReelEntry | null>(null);
  /** The reel, readable outside a render, for the teardown below. */
  const reelRef = useRef<ReelEntry[]>(reel);
  reelRef.current = reel;
  /**
   * A moment that fell out of the reel while it was still on screen.
   *
   * The reel is capped and evicts the least dramatic entry, so on the
   * thirteenth qualifying hand of a good night the moment being *shown* can be
   * the one being dropped. Its frames then belong to nobody: the reel has let
   * go and the eviction path deliberately does not revoke a picture somebody
   * is still looking at.
   *
   * Recorded here at the moment it happens rather than worked out later by
   * asking whether the reel still contains it. That question has a correct
   * answer, but only if you reason about when React commits two state updates
   * relative to a click, and a URL that leaks when that reasoning is wrong is
   * not worth the cleverness.
   */
  const orphan = useRef<ReelEntry | null>(null);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    saveMomentsEnabled(next);
    if (!next) setCurrent(null);
  }, []);

  /**
   * The element this seat's face is coming out of.
   *
   * Our own camera is the local preview; everyone else's is the element the
   * media provider attached for them. Both are elements this hook does not
   * own, does not move and does not detach - see `VideoTile` for why moving
   * one breaks LiveKit's quality negotiation.
   */
  const videoFor = useCallback(
    (peerId: string): HTMLVideoElement | null =>
      peerId === sessionId ? media.localVideo : (media.remotes.get(peerId) ?? null),
    [media.localVideo, media.remotes, sessionId],
  );

  /**
   * Photograph one person. The words were already chosen; see `castCaptions`.
   *
   * Deliberately does *no* choosing of its own. Everything that has to match
   * across six browsers is decided synchronously before any of these run,
   * because these run concurrently and a draw taken from inside one of them
   * would be a draw taken in whatever order the promises happened to settle.
   */
  const shootPerson = useCallback(
    async (person: MomentPerson, caption: string): Promise<ReelFace> => {
      // A camera that is off produces null, and that is a supported outcome
      // rather than a failure: the card renders their avatar and the joke,
      // which the brief asks for explicitly.
      const cameraOff =
        person.sessionId === sessionId
          ? media.cameraOff
          : media.remoteCameraOff.has(person.sessionId);
      const shot = cameraOff
        ? null
        : await captureFace(
            videoFor(person.sessionId),
            media.faceBoxes.get(person.sessionId),
          );

      return {
        sessionId: person.sessionId,
        displayName: person.displayName,
        avatar: person.avatar,
        shot,
        caption,
      };
    },
    [
      media.cameraOff,
      media.faceBoxes,
      media.remoteCameraOff,
      sessionId,
      videoFor,
    ],
  );

  const capture = useCallback(
    (snapshot: RoomSnapshot) => {
      if (!enabled) return;
      if (snapshot.phase !== TablePhase.Payout) return;
      // Idempotent. The overlay can reach its last beat more than once - a
      // skip, a re-render, a late patch - and a second photograph of the same
      // hand would be a second moment stacked on the first.
      if (capturedHand.current === snapshot.handNumber) return;
      capturedHand.current = snapshot.handNumber;

      // One generator per hand, derived from state every client already has.
      // This is what makes six people look at the same card: the treatment and
      // every caption below come out of it, in a fixed order, so each browser
      // computes the same answer without anybody being told. See `seed.ts`.
      const random = seededRandom(momentSeed(snapshot.code, snapshot.handNumber));

      const plan = planMoment({
        snapshot,
        random,
        lastTreatment: lastTreatment.current,
      });
      if (!plan) return;
      lastTreatment.current = plan.treatment;

      // Every caption, now, synchronously, in one fixed order: the hero, then
      // the fallen in the order the plan listed them, then the witnesses.
      // The order is the whole point - it is the sequence of draws from
      // `random`, and two clients that drew in different orders would agree on
      // the seed and still disagree on the words.
      const cast = [plan.hero, ...plan.fallen, ...plan.witnesses];
      const lines = new Map<number, string>();
      for (const person of cast) {
        const choice = pickCaption({
          pools: person.pools,
          memory: captions.current,
          // The hand number is the clock here: the cooldown is measured in
          // hands, so a caption used two hands ago stays out of the running
          // however long the table spent talking about it.
          handNumber: plan.handNumber,
          random,
        });
        captions.current = choice.memory;
        lines.set(person.seat, choice.text);
      }
      const lineFor = (person: MomentPerson) => lines.get(person.seat) ?? "OOF.";

      void (async () => {
        try {
          // One pass, in parallel: every element already has its frame
          // decoded, so this is six `drawImage` calls and six encodes handed
          // to the browser at once, at the one moment in a hand when nothing
          // is animating.
          const [hero, fallen, witnesses] = await Promise.all([
            shootPerson(plan.hero, lineFor(plan.hero)),
            Promise.all(plan.fallen.map((p) => shootPerson(p, lineFor(p)))),
            Promise.all(plan.witnesses.map((p) => shootPerson(p, lineFor(p)))),
          ]);

          const entry: ReelEntry = {
            handNumber: plan.handNumber,
            tier: plan.tier,
            triggers: plan.triggers,
            treatment: plan.treatment,
            pot: plan.pot,
            hero,
            won: plan.hero.won,
            fallen,
            witnesses,
          };

          showing.current = entry;
          setCurrent({ plan, hero, fallen, witnesses });
          setReel((current) => {
            const { reel: next, evicted } = addToReel(current, entry);
            // The evicted entry's frames are the only thing in this feature
            // that leaks if forgotten, so they are released the moment the
            // reel lets go of them rather than at teardown.
            if (!evicted) return next;
            if (evicted === showing.current) {
              // Still on screen. `dismiss` releases it.
              orphan.current = evicted;
            } else {
              for (const shot of shotsOf(evicted)) releaseShot(shot);
            }
            return next;
          });
        } catch {
          // Nothing above can throw by design, so reaching here means
          // something we did not anticipate. The correct response is still
          // "no moment", never a broken payout screen.
        }
      })();
    },
    [enabled, shootPerson],
  );

  const dismiss = useCallback(() => {
    // Cheap to call repeatedly, because it is: `Table` calls it on every
    // render where the table is not in a payout, which is most of them.
    if (!showing.current && !orphan.current) return;
    // Normally nothing is revoked here: the reel is still holding this entry
    // and the recap at the end of the night renders it, so `addToReel` owns
    // the eviction and the unmount below owns the rest.
    //
    // The exception is narrow and would have leaked. A moment can be evicted
    // *while it is on screen* - the reel is full and this one is the least
    // dramatic in it, which happens on the thirteenth qualifying hand of a
    // good night. `addToReel` correctly hands it back, and the eviction path
    // deliberately does not revoke a moment somebody is still looking at, so
    // this is the only place left that can. An entry that is no longer in the
    // reel is nobody else's to release.
    showing.current = null;
    setCurrent(null);
    if (orphan.current) {
      for (const shot of shotsOf(orphan.current)) releaseShot(shot);
      orphan.current = null;
    }
  }, []);

  useEffect(
    // Everything this session ever captured, released in one place. The reel
    // is read through a ref rather than listed as a dependency, because this
    // must run exactly once, at teardown - and an orphaned moment is
    // released with it, since by then nobody is going to dismiss it.
    () => () => {
      const held = new Set(reelRef.current);
      if (orphan.current) held.add(orphan.current);
      for (const entry of held) {
        for (const shot of shotsOf(entry)) releaseShot(shot);
      }
    },
    [],
  );

  return { current, reel, capture, dismiss, enabled, setEnabled };
}

/** Re-exported so the UI does not have to know which module owns a `Shot`. */
export type { Shot };
