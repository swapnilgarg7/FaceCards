import { describe, expect, it } from "vitest";
import { FIRST_HAND_GRACE_MS, HAND_START_DELAY_MS } from "@facecards/shared";
import { dealDelayMs, type DealSeat } from "./firstDeal.js";

function seat(over: Partial<DealSeat> = {}): DealSeat {
  return { ready: true, connected: true, sittingOut: false, funded: true, ...over };
}

describe("holding the first deal for the whole table", () => {
  it("waits out the grace while anyone here has not pressed Play", () => {
    const table = [seat(), seat(), seat({ ready: false })];
    expect(dealDelayMs(table, false)).toBe(FIRST_HAND_GRACE_MS);
  });

  it("deals on the normal beat once everyone here is ready", () => {
    const table = [seat(), seat(), seat()];
    expect(dealDelayMs(table, false)).toBe(HAND_START_DELAY_MS);
  });

  it("holds for five friends who have not clicked yet, not just one", () => {
    const table = [seat(), seat(), ...Array.from({ length: 5 }, () => seat({ ready: false }))];
    expect(dealDelayMs(table, false)).toBe(FIRST_HAND_GRACE_MS);
  });

  it("never waits on a seat that cannot press Play", () => {
    const table = [
      seat(),
      seat(),
      seat({ ready: false, connected: false }),
      seat({ ready: false, sittingOut: true }),
      seat({ ready: false, funded: false }),
    ];
    expect(dealDelayMs(table, false)).toBe(HAND_START_DELAY_MS);
  });

  it("is the plain beat for every hand after the first, whoever is undecided", () => {
    const table = [seat(), seat(), seat({ ready: false })];
    expect(dealDelayMs(table, true)).toBe(HAND_START_DELAY_MS);
  });

  it("does not wait for an empty table to make up its mind", () => {
    expect(dealDelayMs([], false)).toBe(HAND_START_DELAY_MS);
  });
});
