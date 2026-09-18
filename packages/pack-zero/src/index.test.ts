import { isComplement } from "@intentexchange/spec";
import { describe, expect, it } from "vitest";
import { FEASIBILITY_MATRIX, OFFERS, WANTS } from "./fixtures.js";
import { PACK_ZERO } from "./pack.js";

describe("exchange.v0 feasibility matrix", () => {
  it("matches expected complements", () => {
    for (const [i, want] of WANTS.entries()) {
      for (const [j, offer] of OFFERS.entries()) {
        expect(isComplement(PACK_ZERO, want, offer), `want ${i + 1} vs offer ${j + 1}`).toBe(
          FEASIBILITY_MATRIX[i]![j],
        );
      }
    }
  });
});
