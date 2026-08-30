import { describe, expect, it } from "vitest";
import { holdForTable, type DealSeat } from "./firstDeal.js";

function seat(over: Partial<DealSeat> = {}): DealSeat {
  return { ready: true, connected: true, sittingOut: false, funded: true, ...over };
}

describe("holding the first deal for the whole table", () => {
  it("holds while anyone here has not pressed Play", () => {
    expect(holdForTable([seat(), seat(), seat({ ready: false })], false)).toBe(true);
  });

  it("deals once everyone here is ready", () => {
    expect(holdForTable([seat(), seat(), seat()], false)).toBe(false);
  });

  it("holds for five friends who have not clicked, not just one", () => {
    const table = [seat(), seat(), ...Array.from({ length: 5 }, () => seat({ ready: false }))];
    expect(holdForTable(table, false)).toBe(true);
  });

  it("never waits on a seat that could not press Play", () => {
    const table = [
      seat(),
      seat(),
      seat({ ready: false, connected: false }),
      seat({ ready: false, sittingOut: true }),
      seat({ ready: false, funded: false }),
    ];
    expect(holdForTable(table, false)).toBe(false);
  });

  it("holds nothing once the table has played a hand", () => {
    expect(holdForTable([seat(), seat(), seat({ ready: false })], true)).toBe(false);
  });

  it("does not wait for an empty table to make up its mind", () => {
    expect(holdForTable([], false)).toBe(false);
  });
});
