Defects
1. HIGH — the action clock is client-resettable; any client can stall the table indefinitely
server/src/rooms/PokerRoom.ts:224 (onDrop), :251 (onReconnect), :406-430 (armTurnClock)

armTurnClock() unconditionally clears the pending timer and starts a new one for the full budget, with no accounting of elapsed time. It re-arms for hand.actingSeat — whoever that is, not the player whose connection changed. Two consequences:

The acting player drops at 29 of 30 seconds (ws.close() from devtools is a non-consented drop), gets 5s, reconnects, gets a fresh 30s. Repeatable forever.
Worse: any other player at the table can drop/reconnect on a loop and hand the acting seat a fresh 30 seconds every cycle, without ever being in the hand.
This is also a plain correctness bug in normal use: one player's wifi hiccup restarts the acting player's countdown, and the client bar follows it (client/src/ui/TurnClock.tsx re-runs its effect on [turn, actingMs]). It defeats the phase-3 exit criterion that a closed laptop cannot stall the table.

Fix: record turnStartedAt = Date.now() at every point turnToken is bumped (:370, :561, :278) and in armTurnClock compute remaining = Math.max(0, budget - (Date.now() - turnStartedAt)), publishing state.actingMs = remaining. On drop use Math.min(remaining, DISCONNECTED_TURN_TIMEOUT_MS); a reconnect must never raise the deadline back above turnStartedAt + TURN_TIMEOUT_MS.

2. MEDIUM — a refused timeout action kills the clock permanently
server/src/rooms/PokerRoom.ts:456-464


const outcome = this.commit(hand, seat, action);
if (!outcome.ok) {
  console.error(...);   // and nothing else
}
this.turnTimer was already set to undefined at :427, and turnToken / hand.actingSeat are unchanged, so nothing re-arms. Reachable when legalActions(hand, seat) returns null: :446's ?.canCheck yields undefined → fold → applyAction answers "not in this hand" (engine.ts:606). The comment says "the clock cannot be the thing that wedges a table"; the code wedges it. Fix: on failure call forfeit(hand, seat), bump turnToken, syncHand().

3. MEDIUM — no rate limit on any client message
server/src/rooms/PokerRoom.ts:134-157

Action: the turn-token guard at :329 is conditional on hand.actingSeat === player.seat, so out-of-turn spam reaches applyAction + legalActions every time and gets an ActionRejected send back. Full engine evaluation per inbound frame.
SitOut/SitIn (:138-152) write player.sittingOut with no equality check and no debounce. Because sittingOut is a public schema field, one inbound byte becomes a patch fanned out to all six clients — cheap amplification.
RequestMediaToken (:154) mints an HMAC-signed JWT per message with no cooldown.
Fix: per-client token bucket in onCreate; early-return SitOut/SitIn when the value is unchanged; cap RequestMediaToken to roughly one per minute.

4. MEDIUM — free rebuy still survives phase 3
server/src/rooms/PokerRoom.ts:262-282 (onLeave), :172 (player.stack = STARTING_STACK)

room.leave() is a consented close, so Colyseus routes it straight to onLeave and skips the reconnection window entirely (Room.mjs:1049). The seat is freed and the Player deleted; rejoining the same code hands out a fresh 1000. Phase 3 gave identity continuity across a drop but not across a leave, so a losing player still controls their own balance by leaving and coming back. Documented at README.md:197, but it is the one remaining path where a client decides an outcome. Fix: key stacks to a stable per-room identity rather than to the session.

5. LOW — sit-out/sit-in are ownership-checked but not legality-checked
server/src/rooms/PokerRoom.ts:138-152

The sender is correctly re-derived from client.sessionId and the flag correctly only takes effect at eligiblePlayers() (:513-526), so nothing mid-hand is affected. considerDealing() (:507-511) is idempotent against a deal storm. The only exposure is the unthrottled public flag flip, covered by fix 3.

6. LOW — onReconnect admits a seatless client rather than refusing
server/src/rooms/PokerRoom.ts:235-236

if (!player) return; leaves the client JOINED, holding the previous client's StateView and occupying a clients slot with no Player. No leak (a detached instance is skipped by encodeView) and I could not construct a reachable path, but the correct form is throw, which Colyseus converts to _onLeave(client, FAILED_TO_RECONNECT) (Room.mjs:711-713).

7. Not a defect — seat hijack through the reconnection window is not possible
claimSeat (:604-612) skips both takenSeats and any seat the running hand still holds, and neither is released until onLeave runs. The write side re-checks playerId independently (server/src/state/mirror.ts:48-54). Reconnection is keyed on client.reconnectionToken — nanoid(9), ~54 bits from a CSPRNG (Room.mjs:661) — not on Player.sessionId, which is public in the schema but is not a credential (MatchMaker.mjs:136-145). Worth recording for the future: a leaked reconnection token lets the holder forcibly close the live client and take over the seat and its hole-card view (Room.mjs:351-353), so that token must never be logged, persisted or put in a URL. Today the SDK keeps it in memory only.