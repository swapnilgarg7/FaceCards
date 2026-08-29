import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import type { GateState } from "./startGate.js";

/**
 * "Play", and what the table is still waiting for.
 *
 * Nothing is dealt until the people at the table say they are ready. It sits
 * where the action bar sits - bottom centre, over this seat's own cards -
 * because it is the same thing at an earlier moment: the one decision in
 * front of this player right now.
 *
 * It replaces the action bar rather than joining it. A player who has not
 * pressed Play is not in the game, and a row of Fold/Check/Raise buttons
 * greyed out above a Play button is two answers to the same question.
 *
 * All the deciding is in `startGate.ts`; this renders the answer. The button
 * sends an intent, exactly like every other control in the product: the
 * server counts the ready seats and decides when to deal.
 */
export function PlayGate({
  gate,
  snapshot,
  me,
  onReady,
}: {
  gate: GateState;
  snapshot: RoomSnapshot;
  me: SeatSnapshot | undefined;
  onReady(): void;
}) {
  if (!gate.show || !me) return null;

  return (
    <div className="gate" role="status">
      <p className="gate__lede">
        {gate.canPlay
          ? gate.started
            ? "This table is already playing. You are dealt in when you say so."
            : "No cards are dealt until you are ready."
          : "Ready. Waiting for the table."}
      </p>

      {gate.canPlay && (
        <button className="btn btn--act btn--play" onClick={onReady}>
          <span className="btn__label">
            {gate.started ? "Deal me in" : "Play"}
          </span>
        </button>
      )}

      <p className="gate__meta">
        <span className="gate__count">
          {gate.ready} of {gate.seated} ready
        </span>
        {gate.needed > 0 && gate.waitingOn.length === 0 && (
          <span>
            {/* Nobody left to wait on: the table itself is short. */}
            {gate.needed === 1
              ? "One more player is needed"
              : `${gate.needed} more players are needed`}
          </span>
        )}
        {!gate.canPlay && gate.waitingOn.length > 0 && (
          <span>Waiting for {list(gate.waitingOn)}</span>
        )}
      </p>

      {/* The room code, here as well as in the corner, because "nobody else
          is here yet" is precisely the moment somebody needs to read it out
          to the person they are on the phone to. */}
      {gate.seated < 2 && (
        <p className="gate__code">
          Invite them with <b className="code">{snapshot.code}</b>
        </p>
      )}
    </div>
  );
}

/** "Bea", "Bea and Cal", "Bea, Cal and Dev". */
function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
