import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUY_IN,
  MAX_BUY_IN,
  MAX_STACK,
  MIN_BUY_IN,
  SeatStatus,
} from "@facecards/shared";
import type { SeatSnapshot } from "../net/useRoom.js";
import { rebuyOffer } from "./rebuy.js";

function seat(over: Partial<SeatSnapshot> = {}): SeatSnapshot {
  return {
    sessionId: "a",
    displayName: "A",
    avatar: "cowboy",
    seat: 0,
    connected: true,
    ready: true,
    readyNext: false,
    sittingOut: false,
    stack: 1000,
    bet: 0,
    totalBuyIn: 1000,
    pendingBuyIn: 0,
    handsPlayed: 3,
    handsWon: 0,
    status: SeatStatus.Waiting,
    cardCount: 0,
    ...over,
  };
}

describe("offering the rebuy where losing actually happens", () => {
  it("asks a busted seat, with one press per amount", () => {
    const offer = rebuyOffer(seat({ stack: 0 }));
    expect(offer.show).toBe(true);
    expect(offer.busted).toBe(true);
    expect(offer.presets).toEqual([MIN_BUY_IN, DEFAULT_BUY_IN, MAX_BUY_IN]);
  });

  it("offers amounts in ascending order with no duplicates", () => {
    const { presets } = rebuyOffer(seat({ stack: 0 }));
    expect([...presets].sort((a, b) => a - b)).toEqual(presets);
    expect(new Set(presets).size).toBe(presets.length);
  });

  it("never offers an amount the server would refuse", () => {
    const { presets } = rebuyOffer(seat({ stack: 0 }));
    for (const amount of presets) {
      expect(amount).toBeGreaterThanOrEqual(MIN_BUY_IN);
      expect(amount).toBeLessThanOrEqual(MAX_BUY_IN);
      expect(amount).toBeLessThanOrEqual(MAX_STACK);
    }
  });

  it("confirms rather than asks again once they have bought", () => {
    const offer = rebuyOffer(seat({ stack: 0, pendingBuyIn: 1000 }));
    expect(offer.show).toBe(true);
    expect(offer.pending).toBe(1000);
    expect(offer.presets).toEqual([]);
  });

  it("stays out of the way of a seat that still has chips", () => {
    expect(rebuyOffer(seat({ stack: 400 })).show).toBe(false);
  });

  it("shows nothing to a spectator with no seat", () => {
    expect(rebuyOffer(undefined).show).toBe(false);
  });
});
