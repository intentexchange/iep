import { OFFER_MANDATE, OFFER_MANDATE_NO_ZONE, WANT_1, WANT_MANDATE, WANT_MANDATE_NO_ZONE, OFFER_1 } from "@iep/pack-zero";
import { type Mandate, type Range, type UnsignedMandate } from "@iep/spec";
import { describe, expect, it } from "vitest";
import { decide, deriveStartAt, intersectRanges, openingPrice, roundPrice, windowStartOf } from "./negotiate.js";

const asMandate = (body: Omit<UnsignedMandate, "principal_did" | "agent_did">): Mandate => ({
  principal_did: "did:key:p",
  agent_did: "did:key:a",
  ...body,
  signature: "fixture",
});

const bargain = (want: Mandate, offer: Mandate, zone: Range): { price: number; rounds: number } => {
  let wantMine: number | undefined;
  let offerMine: number | undefined;
  let lastWant: number | undefined;
  let lastOffer: number | undefined;
  for (let round = 1; round <= 8; round += 1) {
    const side = round % 2 === 1 ? "want" : "offer";
    const mandate = side === "want" ? want : offer;
    const mine = side === "want" ? wantMine : offerMine;
    const theirs = side === "want" ? lastOffer : lastWant;
    const decision = decide({
      role: side,
      zone,
      ...(mine !== undefined ? { mine } : {}),
      ...(theirs !== undefined ? { theirs } : {}),
      nextRound: round,
      mandate,
    });
    if (decision.kind === "accept") {
      const price = theirs;
      if (price === undefined) {
        throw new Error("accept without a peer price");
      }
      return { price, rounds: round };
    }
    if (decision.kind === "reject") {
      throw new Error(`rejected at round ${round}: ${decision.reason}`);
    }
    if (side === "want") {
      wantMine = decision.price;
      lastWant = decision.price;
    } else {
      offerMine = decision.price;
      lastOffer = decision.price;
    }
  }
  throw new Error("did not converge");
};

describe("negotiate", () => {
  it("intersects revealed bands and opens at the zone edges", () => {
    const zone = intersectRanges(WANT_MANDATE.reveal.price, OFFER_MANDATE.reveal.price);
    expect(zone).toEqual({ min: 45, max: 55 });
    expect(openingPrice("want", zone!)).toBe(45);
    expect(openingPrice("offer", zone!)).toBe(55);
    expect(intersectRanges(WANT_MANDATE_NO_ZONE.reveal.price, OFFER_MANDATE_NO_ZONE.reveal.price)).toBeNull();
  });

  it("converges inside both limits within 8 rounds", () => {
    const want = asMandate(WANT_MANDATE);
    const offer = asMandate(OFFER_MANDATE);
    const zone = intersectRanges(want.reveal.price, offer.reveal.price)!;
    const result = bargain(want, offer, zone);
    expect(result.rounds).toBeLessThanOrEqual(8);
    expect(result.price).toBeGreaterThanOrEqual(zone.min);
    expect(result.price).toBeLessThanOrEqual(zone.max);
    expect(result.price).toBeLessThanOrEqual(want.limits.price.max!);
    expect(result.price).toBeGreaterThanOrEqual(offer.limits.price.min!);
  });

  it("never proposes outside mandate limits across a band sweep", () => {
    const bands: Range[] = [
      { min: 30, max: 55 },
      { min: 45, max: 80 },
      { min: 40, max: 50 },
      { min: 10, max: 90 },
    ];
    for (const reveal of bands) {
      const mandate = asMandate({
        ...WANT_MANDATE,
        reveal: { price: reveal },
        limits: { price: { min: 40, max: 60 } },
      });
      const zone = intersectRanges(reveal, { min: 40, max: 60 });
      if (!zone) {
        continue;
      }
      const opening = decide({ role: "want", zone, nextRound: 1, mandate });
      if (opening.kind === "propose") {
        expect(opening.price).toBeGreaterThanOrEqual(40);
        expect(opening.price).toBeLessThanOrEqual(60);
      }
      const counter = decide({
        role: "want",
        zone,
        mine: 45,
        theirs: 58,
        nextRound: 3,
        mandate,
      });
      if (counter.kind === "propose") {
        expect(counter.price).toBeGreaterThanOrEqual(40);
        expect(counter.price).toBeLessThanOrEqual(60);
      }
    }
  });

  it("derives start_at as the later window start", () => {
    expect(windowStartOf(WANT_1.public_body)).toBe("2026-10-01T00:00:00.000Z");
    expect(deriveStartAt(windowStartOf(WANT_1.public_body), windowStartOf(OFFER_1.public_body))).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(roundPrice(51.255)).toBe(51.26);
  });
});
