import { StateView } from "@colyseus/schema";
import type { Client } from "colyseus";
import type { PlayerInstance } from "@facecards/shared";

/**
 * StateView wiring. Server-only: the schema *shape* is shared protocol, but
 * who is allowed to see which instance of it is a server decision and lives
 * here alone.
 *
 * Every `{ view: true }` field in `shared/src/state.ts` is delivered only to
 * clients whose view contains that instance. Verified empirically before this
 * was built on: another client's payload does not contain the field at all,
 * rather than containing it and trusting the client not to render it.
 *
 * `holeCard0` and `holeCard1` ride on this and on nothing else. There is one
 * function in the codebase that decides who can see a card, and this is it.
 * The only other way a card becomes public is a `Reveal` written at a real
 * showdown, which is a deliberate publication rather than a view.
 */
export function grantOwnPlayerView(
  client: Client,
  player: PlayerInstance,
): void {
  const view = new StateView();
  view.add(player);
  client.view = view;
}
