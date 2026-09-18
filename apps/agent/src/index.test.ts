import { PACK_ZERO } from "@iep/pack-zero";
import { authorize, ERROR_CODES, generateKeyPair, IepError, signDocument, type Mandate } from "@iep/spec";
import { describe, expect, it } from "vitest";
import { autoSigner } from "./principal.js";

describe("mandate gate", () => {
  it("denies verbs that are not granted", async () => {
    const keys = await generateKeyPair();
    const mandate: Mandate = {
      principal_did: keys.did,
      agent_did: keys.did,
      grants: ["query"],
      ping_cap: 1,
      expires_at: "2030-01-01T00:00:00.000Z",
      reveal: { price: { min: 1, max: 2 } },
      limits: { price: { max: 10 } },
      signature: "fixture",
    };
    expect(() => authorize(mandate, "publish")).toThrow(IepError);
    try {
      authorize(mandate, "publish");
    } catch (error) {
      expect((error as IepError).code).toBe(ERROR_CODES.IEP_MANDATE_DENIED);
    }
  });

  it("keeps sealed fields off the public field list", () => {
    expect(PACK_ZERO.sealed_fields).toContain("reserve");
    expect(PACK_ZERO.public_fields).not.toContain("reserve");
  });

  it("auto-signer produces a principal signature", async () => {
    const keys = await generateKeyPair();
    const signer = autoSigner(keys);
    const signature = await signer.ratify(
      {
        session_id: "a".repeat(64),
        schema: "iep:exchange.v0",
        round: 1,
        alpha_intent: "11111111-1111-4111-8111-111111111111",
        beta_intent: "22222222-2222-4222-8222-222222222222",
        terms: { price: 50, start_at: "2026-11-01T00:00:00.000Z" },
      },
      "2030-01-01T00:00:00.000Z",
    );
    expect(signature).toEqual(expect.any(String));
    expect(signer.did).toBe(keys.did);
    expect(signDocument).toEqual(expect.any(Function));
  });
});
