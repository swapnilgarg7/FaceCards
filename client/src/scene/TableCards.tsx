import { useEffect, useMemo, useRef, useState } from "react";
import { SeatStatus } from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import { BACK_SLOT } from "./cardAtlas.js";
import {
  BOARD_SIZE,
  boardSpot,
  cardIndex,
  deckSpot,
  holeSpot,
  muckSpot,
  type CardSpot,
} from "./cards.js";
import type { Seat } from "./layout.js";
import { TableCard } from "./TableCard.js";
import { DEAL_STEP_MS, FLOP_STEP_MS, dealSchedule } from "./tween.js";

/**
 * Every card on the felt: the board, and two in front of each seat.
 *
 * The HUD still lists your own two cards, because spec section 8 wants the
 * flat controls as a fallback and your own hand is the one thing you should
 * never have to hunt for. Everything else about a card - that it was dealt to
 * a person, that it is face down, that it just landed, that someone let go of
 * it - now happens here, on the table, where those facts are physical rather
 * than typographic.
 *
 * What this component knows about a card is exactly what the server sent this
 * client: the board, this player's own two, and whatever a showdown chose to
 * publish. Every other card is a `BACK_SLOT` geometry carrying no value at
 * all. The peek never goes near the network, because the cards it lifts were
 * already in this client's own state.
 */

/** How long a mucked hand stays on the table on its way out. */
const MUCK_MS = 520;

interface Arrival {
  /** Changing this starts a flight. */
  key: string;
  delayMs: number;
  from: CardSpot;
}

export interface TableCardsProps {
  snapshot: RoomSnapshot;
  /** Server seat index -> where that seat sits in the ring right now. */
  placed: Map<number, Seat>;
  sessionId: string | null;
  /** True while the local player is holding their cards up to look at them. */
  peeking: boolean;
  /** Press and hold on your own cards: the other half of the peek. */
  onPeekChange(peeking: boolean): void;
  /**
   * Whether the invisible press-and-hold pad over this seat's own cards is
   * offered at all. False on a touchscreen, where the same press is already
   * the drag that turns the head.
   */
  peekPad?: boolean;
}

export function TableCards({
  snapshot,
  placed,
  sessionId,
  peeking,
  onPeekChange,
  peekPad = true,
}: TableCardsProps) {
  const button = placed.get(snapshot.buttonSeat);
  const deck = useMemo(() => deckSpot(button), [button]);

  // Where a card that is arriving comes from. State rather than a ref because
  // it changes a handful of times a hand and never per frame.
  const [arrivals, setArrivals] = useState<Map<string, Arrival>>(new Map());
  const boardSeen = useRef(0);
  const dealt = useRef(false);

  // Read at deal time rather than depended on. A fold zeroes `cardCount`, so
  // depending on who holds cards would re-deal the whole table every time
  // somebody let go of a hand.
  const table = useRef({ players: snapshot.players, placed, deck, button });
  table.current = { players: snapshot.players, placed, deck, button };

  // A new hand: every hole card flies out of the deck, in the order a dealer
  // deals - once round the table, then round again.
  useEffect(() => {
    boardSeen.current = 0;

    // Joining mid-hand, or reconnecting into one, must not replay a deal that
    // already happened. Cards simply appear where they belong.
    if (!dealt.current) {
      dealt.current = true;
      setArrivals(new Map());
      return;
    }

    const current = table.current;
    const seats = current.players
      .filter((player) => player.cardCount > 0)
      .map((player) => player.seat);

    const bySlot = new Map<number, number>();
    for (const seat of seats) {
      const ring = current.placed.get(seat);
      if (ring) bySlot.set(ring.index, seat);
    }
    const slots = [...bySlot.keys()].sort((a, b) => a - b);

    const next = new Map<string, Arrival>();
    for (const step of dealSchedule(
      slots,
      current.button?.index ?? -1,
      DEAL_STEP_MS,
    )) {
      const seat = bySlot.get(step.slot);
      if (seat === undefined) continue;
      next.set(`hole:${seat}:${step.cardIndex}`, {
        key: String(snapshot.handNumber),
        delayMs: step.delayMs,
        from: current.deck,
      });
    }
    setArrivals(next);
  }, [snapshot.handNumber]);

  // A street: the new community cards come out of the same deck.
  useEffect(() => {
    const count = snapshot.board.length;
    if (count <= boardSeen.current) {
      boardSeen.current = count;
      return;
    }
    const first = boardSeen.current;
    boardSeen.current = count;
    const from = table.current.deck;

    setArrivals((previous) => {
      const next = new Map(previous);
      for (let i = first; i < count; i++) {
        next.set(`board:${i}`, {
          key: `${snapshot.handNumber}:${i}`,
          delayMs: (i - first) * FLOP_STEP_MS,
          from,
        });
      }
      return next;
    });
  }, [snapshot.board.length, snapshot.handNumber]);

  const mucking = useMuckingSeats(snapshot);

  const revealBySeat = useMemo(
    () => new Map(snapshot.reveals.map((reveal) => [reveal.seat, reveal])),
    [snapshot.reveals],
  );

  const me = snapshot.players.find((player) => player.sessionId === sessionId);
  const mySeat = me ? placed.get(me.seat) : undefined;

  return (
    <group>
      {Array.from({ length: BOARD_SIZE }, (_, i) => {
        const card = snapshot.board[i];
        const slot = cardIndex(card);
        const arrival = arrivals.get(`board:${i}`);
        return (
          <TableCard
            key={`board:${i}`}
            faceSlot={slot >= 0 ? slot : BACK_SLOT}
            spot={boardSpot(i)}
            faceUp={slot >= 0}
            visible={slot >= 0}
            from={arrival?.from ?? null}
            arriveKey={arrival?.key}
            delayMs={arrival?.delayMs ?? 0}
            seed={1000 + i}
          />
        );
      })}

      {snapshot.players.map((player) => {
        const seat = placed.get(player.seat);
        if (!seat) return null;

        const isMe = player.sessionId === sessionId;
        const reveal = revealBySeat.get(player.seat);
        const folded = player.status === SeatStatus.Folded;
        // Your own cards come from the private field only your client
        // receives; everyone else's only from a showdown the server published.
        const known = isMe ? player.holeCards : reveal?.cards;
        const leaving = mucking.has(player.seat);

        return Array.from({ length: 2 }, (_, i) => {
          const slot = cardIndex(known?.[i]);
          const arrival = arrivals.get(`hole:${player.seat}:${i}`);
          // A hand being let go stays face down on its way out, even on the
          // one client that knows what it was.
          const hidden = folded || leaving || slot < 0;
          const faceUp = !hidden && (!isMe || peeking);

          return (
            <TableCard
              key={`hole:${player.sessionId}:${i}`}
              faceSlot={hidden ? BACK_SLOT : slot}
              spot={
                folded || leaving ? muckSpot(seat, i) : holeSpot(seat, i)
              }
              faceUp={faceUp}
              visible={player.cardCount > i || leaving}
              from={arrival?.from ?? null}
              arriveKey={arrival?.key}
              delayMs={arrival?.delayMs ?? 0}
              peek={isMe && peeking && !hidden ? 1 : 0}
              // -1 and +1: the pair opens outwards from the middle rather
              // than the second card sliding across the first.
              peekFan={i * 2 - 1}
              seed={player.seat * 17 + i}
            />
          );
        });
      })}

      {/* Press and hold your own cards to look at them. An invisible pad over
          the pair rather than the cards themselves, because the cards move
          when you pick them up, and a hit target that runs away mid-gesture
          is a hit target you lose halfway through it. */}
      {peekPad && me && me.cardCount > 0 && mySeat && (
        <PeekPad seat={mySeat} active={peeking} onPeekChange={onPeekChange} />
      )}
    </group>
  );
}

/**
 * Seats whose cards are on their way to the muck.
 *
 * The server zeroes `cardCount` the instant a seat folds, which is correct -
 * that hand is out - but it means the cards would blink out of existence. A
 * fold is the most physical thing that happens at a table without chips
 * moving, so it gets the half second it takes to push a hand away.
 */
function useMuckingSeats(snapshot: RoomSnapshot): Set<number> {
  const [mucking, setMucking] = useState<Set<number>>(new Set());
  const previous = useRef(new Map<number, SeatSnapshot["status"]>());
  const timers = useRef(new Map<number, number>());

  useEffect(() => {
    const folded: number[] = [];
    for (const player of snapshot.players) {
      const before = previous.current.get(player.seat);
      if (before !== SeatStatus.Folded && player.status === SeatStatus.Folded) {
        folded.push(player.seat);
      }
      previous.current.set(player.seat, player.status);
    }
    if (folded.length === 0) return;

    setMucking((current) => new Set([...current, ...folded]));
    for (const seat of folded) {
      const existing = timers.current.get(seat);
      if (existing !== undefined) window.clearTimeout(existing);
      timers.current.set(
        seat,
        window.setTimeout(() => {
          timers.current.delete(seat);
          setMucking((current) => {
            const next = new Set(current);
            next.delete(seat);
            return next;
          });
        }, MUCK_MS),
      );
    }
  }, [snapshot.players]);

  // A new hand deals over the top of anything still on its way out.
  useEffect(() => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
    setMucking(new Set());
  }, [snapshot.handNumber]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return mucking;
}

function PeekPad({
  seat,
  active,
  onPeekChange,
}: {
  seat: Seat;
  active: boolean;
  onPeekChange(peeking: boolean): void;
}) {
  const centre = useMemo(() => {
    const a = holeSpot(seat, 0);
    const b = holeSpot(seat, 1);
    return { x: (a.x + b.x) / 2, y: a.y, z: (a.z + b.z) / 2 };
  }, [seat]);

  // The gesture ends wherever the cursor happens to be, which is routinely no
  // longer over the pad: a press that runs off the edge must still put the
  // cards back down.
  useEffect(() => {
    if (!active) return;
    const release = () => onPeekChange(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [active, onPeekChange]);

  return (
    <mesh
      position={[centre.x, centre.y + 0.003, centre.z]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPeekChange(true);
      }}
    >
      <planeGeometry args={[0.17, 0.13]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}
