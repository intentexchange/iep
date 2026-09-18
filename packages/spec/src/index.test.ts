import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonicalize.js";
import {
  commit,
  dealId,
  generateKeyPair,
  mandateCid,
  ratificationPayload,
  sessionId,
  signDocument,
  signRatification,
  termSheetHash,
  verifyRatification,
  verifySignedDocument,
} from "./crypto.js";
import { publicKeyToDidKey } from "./did.js";
import { ERROR_CODES, IepError } from "./errors.js";
import { isComplement } from "./predicates.js";
import { assertFreshTs, rememberNonce, transition } from "./session.js";
import {
  IEP_VERSION,
  type IntentDocument,
  type Mandate,
  type SchemaPack,
  type TermSheet,
  type UnsignedMandate,
} from "./types.js";
import {
  assertNoSealedLeak,
  assertTermKeys,
  assertWithinLimits,
  assertWithinReveal,
  parseIntentDocument,
  parseMandate,
  parseRevealBody,
  parseVerbEnvelope,
  verifyMandate,
} from "./validate.js";

const dir = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(dir, "../schemas");

const loadSchema = (name: string): object => {
  return JSON.parse(readFileSync(join(schemaDir, name), "utf8")) as object;
};

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const unsignedMandate = (principalDid: string, agentDid: string): UnsignedMandate => ({
  principal_did: principalDid,
  agent_did: agentDid,
  grants: ["publish", "query", "ping", "accept", "reveal", "propose", "ratify"],
  ping_cap: 3,
  expires_at: "2030-01-01T00:00:00.000Z",
  reveal: { price: { min: 30, max: 55 } },
  limits: { price: { max: 60 } },
  max_rounds: 8,
  tolerance: 1,
});

describe("canonicalize", () => {
  it("sorts object keys and is stable", () => {
    const a = canonicalize({ b: 1, a: { d: true, c: "x" } });
    const b = canonicalize({ a: { c: "x", d: true }, b: 1 });
    expect(a).toBe('{"a":{"c":"x","d":true},"b":1}');
    expect(a).toBe(b);
  });
});

describe("crypto", () => {
  it("signs and verifies an intent document", async () => {
    const keys = await generateKeyPair();
    expect(keys.did).toBe(publicKeyToDidKey(keys.publicKey));
    const publicBody = { category: "widget" };
    const unsigned = {
      id: "11111111-1111-4111-8111-111111111111",
      iep: IEP_VERSION,
      schema: "iep:exchange.v0",
      role: "want",
      principal_did: keys.did,
      agent_did: keys.did,
      agent_card: "http://127.0.0.1:41241/.well-known/agent-card.json",
      public_body: publicBody,
      commit_sealed: await commit({ reserve: 10 }),
      commit_public: await commit(publicBody),
      mandate_cid: "mandate:local:v0",
      discovery_providers: ["http://127.0.0.1:8787"],
      expires_at: "2030-01-01T00:00:00.000Z",
    };
    const signed = await signDocument<IntentDocument>(unsigned, keys.privateKeyPkcs8);
    expect(await verifySignedDocument(signed)).toBe(true);
    expect(await commit(publicBody)).toBe(unsigned.commit_public);
  });

  it("derives a stable session id", async () => {
    const a = await sessionId("nonce-1", "sig-1");
    const b = await sessionId("nonce-1", "sig-1");
    const c = await sessionId("nonce-1", "sig-2");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("signs and verifies a mandate; tampered grants fail", async () => {
    const principal = await generateKeyPair();
    const agent = await generateKeyPair();
    const signed = await signDocument<Mandate>(unsignedMandate(principal.did, agent.did), principal.privateKeyPkcs8);
    await expect(verifyMandate(signed, agent.did)).resolves.toBeUndefined();
    const cid = await mandateCid(signed);
    expect(cid).toMatch(/^[0-9a-f]{64}$/u);
    const tampered: Mandate = { ...signed, grants: [...signed.grants, "reject"] };
    await expect(verifyMandate(tampered, agent.did)).rejects.toMatchObject({
      code: ERROR_CODES.IEP_INVALID_MANDATE,
    });
    await expect(verifyMandate(signed, principal.did)).rejects.toMatchObject({
      code: ERROR_CODES.IEP_INVALID_MANDATE,
    });
  });

  it("hashes term sheets stably under key reordering and round-trips ratification", async () => {
    const principal = await generateKeyPair();
    const sheet: TermSheet = {
      session_id: "a".repeat(64),
      schema: "iep:exchange.v0",
      round: 3,
      alpha_intent: "11111111-1111-4111-8111-111111111111",
      beta_intent: "22222222-2222-4222-8222-222222222222",
      terms: { price: 51.25, start_at: "2026-11-01T00:00:00.000Z" },
    };
    const reordered = {
      terms: { start_at: sheet.terms.start_at, price: sheet.terms.price },
      beta_intent: sheet.beta_intent,
      alpha_intent: sheet.alpha_intent,
      round: sheet.round,
      schema: sheet.schema,
      session_id: sheet.session_id,
    };
    const hash = await termSheetHash(sheet);
    expect(hash).toBe(await termSheetHash(reordered as TermSheet));
    const payload = ratificationPayload(sheet.session_id, hash, principal.did, "2030-01-01T00:00:00.000Z");
    const ratification = await signRatification(payload, principal.privateKeyPkcs8);
    expect(await verifyRatification(ratification)).toBe(true);
    const other = await generateKeyPair();
    const forged = await signRatification({ ...payload, principal_did: other.did }, other.privateKeyPkcs8);
    expect(await verifyRatification({ ...forged, principal_did: principal.did })).toBe(false);
    const id = await dealId(sheet.session_id, hash);
    expect(id).toBe(await dealId(sheet.session_id, hash));
    expect(id).not.toBe(await dealId(sheet.session_id, "b".repeat(64)));
  });
});

describe("session state machine", () => {
  it("walks handshook to ratified and rejects illegal verbs", () => {
    let state = transition("handshook", "reveal", "out");
    expect(state).toBe("revealed");
    state = transition(state, "reveal", "in");
    expect(state).toBe("revealed");
    state = transition(state, "propose", "out");
    expect(state).toBe("bargaining");
    state = transition(state, "propose", "in");
    expect(state).toBe("bargaining");
    state = transition(state, "ratify", "out");
    expect(state).toBe("ratifying");
    state = transition(state, "ratify", "in");
    expect(state).toBe("ratified");
    expect(() => transition("ratified", "propose", "out")).toThrow(IepError);
    expect(() => transition("handshook", "propose", "out")).toThrow(IepError);
    expect(transition("bargaining", "reject", "in")).toBe("rejected");
  });

  it("enforces nonce replay and timestamp skew", () => {
    const seen = new Set<string>();
    rememberNonce(seen, "n1");
    expect(() => rememberNonce(seen, "n1")).toThrow(IepError);
    try {
      rememberNonce(seen, "n1");
    } catch (error) {
      expect((error as IepError).code).toBe(ERROR_CODES.IEP_REPLAY);
    }
    const now = Date.parse("2026-09-19T00:00:00.000Z");
    expect(() => assertFreshTs("2026-09-19T00:04:00.000Z", now)).not.toThrow();
    expect(() => assertFreshTs("2026-09-19T00:06:00.000Z", now)).toThrow(IepError);
  });
});

describe("mandate bounds", () => {
  it("parses a signed mandate and gates reveal/limits/term keys", async () => {
    const principal = await generateKeyPair();
    const agent = await generateKeyPair();
    const signed = await signDocument<Mandate>(unsignedMandate(principal.did, agent.did), principal.privateKeyPkcs8);
    const parsed = parseMandate(signed);
    expect(parsed.reveal.price).toEqual({ min: 30, max: 55 });
    expect(() => assertWithinReveal(parsed, { price: { min: 30, max: 55 } })).not.toThrow();
    expect(() => assertWithinReveal(parsed, { price: { min: 20, max: 55 } })).toThrow(IepError);
    expect(() => assertWithinLimits(parsed, { price: 51, start_at: "2026-11-01T00:00:00.000Z" })).not.toThrow();
    expect(() => assertWithinLimits(parsed, { price: 61, start_at: "2026-11-01T00:00:00.000Z" })).toThrow(IepError);
    const pack: SchemaPack = {
      id: "iep:exchange.v0",
      version: "0.1.0",
      roles: { alpha: "want", beta: "offer" },
      public_fields: [],
      sealed_fields: [],
      term_keys: ["price", "start_at"],
      complement: [{ field_a: "category", field_b: "category", op: "eq" }],
    };
    expect(() => assertTermKeys(pack, { price: 1, start_at: "x" })).not.toThrow();
    expect(() => assertTermKeys(pack, { price: 1 })).toThrow(IepError);
    expect(parseRevealBody({
      session_id: "a".repeat(64),
      stage: "ranges",
      terms: { price: { min: 30, max: 55 } },
    }).stage).toBe("ranges");
    expect(parseVerbEnvelope({
      iep: IEP_VERSION,
      verb: "reveal",
      from_intent: "11111111-1111-4111-8111-111111111111",
      to_intent: "22222222-2222-4222-8222-222222222222",
      nonce: "n",
      ts: "2030-01-01T00:00:00.000Z",
      body: {},
      signature: "sig",
    }).verb).toBe("reveal");
  });
});

describe("predicates", () => {
  const pack: SchemaPack = {
    id: "iep:exchange.v0",
    version: "0.1.0",
    roles: { alpha: "want", beta: "offer" },
    public_fields: ["category", "regions", "window"],
    sealed_fields: ["reserve"],
    term_keys: ["price"],
    complement: [
      { field_a: "category", field_b: "category", op: "eq" },
      { field_a: "regions", field_b: "regions", op: "intersects" },
      { field_a: "window", field_b: "window", op: "range_overlap" },
    ],
  };

  const doc = (
    role: "want" | "offer",
    body: IntentDocument["public_body"],
  ): IntentDocument => ({
    id: "11111111-1111-4111-8111-111111111111",
    iep: IEP_VERSION,
    schema: pack.id,
    role,
    principal_did: "did:key:z",
    agent_did: "did:key:z",
    agent_card: "http://127.0.0.1/card",
    public_body: body,
    commit_sealed: "a".repeat(64),
    commit_public: "b".repeat(64),
    mandate_cid: "m",
    discovery_providers: [],
    expires_at: "2030-01-01T00:00:00.000Z",
    signature: "sig",
  });

  it("eq / intersects / range_overlap all pass", () => {
    const want = doc("want", {
      category: "widget",
      regions: ["eu", "us"],
      window: { start: "2026-10-01T00:00:00.000Z", end: "2026-12-31T00:00:00.000Z" },
    });
    const offer = doc("offer", {
      category: "widget",
      regions: ["eu"],
      window: { start: "2026-11-01T00:00:00.000Z", end: "2026-11-30T00:00:00.000Z" },
    });
    expect(isComplement(pack, want, offer)).toBe(true);
  });

  it("fails closed on same role, missing fields, and non-overlap", () => {
    const want = doc("want", {
      category: "widget",
      regions: ["eu"],
      window: { start: "2026-10-01T00:00:00.000Z", end: "2026-10-31T00:00:00.000Z" },
    });
    expect(isComplement(pack, want, want)).toBe(false);
    expect(
      isComplement(
        pack,
        want,
        doc("offer", {
          category: "gadget",
          regions: ["eu"],
          window: { start: "2026-10-01T00:00:00.000Z", end: "2026-10-31T00:00:00.000Z" },
        }),
      ),
    ).toBe(false);
    expect(
      isComplement(
        pack,
        want,
        doc("offer", {
          category: "widget",
          regions: ["apac"],
          window: { start: "2026-10-01T00:00:00.000Z", end: "2026-10-31T00:00:00.000Z" },
        }),
      ),
    ).toBe(false);
    expect(
      isComplement(
        pack,
        want,
        doc("offer", {
          category: "widget",
          regions: ["eu"],
          window: { start: "2027-01-01T00:00:00.000Z", end: "2027-01-31T00:00:00.000Z" },
        }),
      ),
    ).toBe(false);
    expect(isComplement(pack, want, doc("offer", { category: "widget" }))).toBe(false);
  });

  it("supports contains", () => {
    const containsPack: SchemaPack = {
      ...pack,
      complement: [{ field_a: "tags", field_b: "tag", op: "contains" }],
    };
    expect(
      isComplement(
        containsPack,
        doc("want", { tags: ["a", "b"] }),
        doc("offer", { tag: "b" }),
      ),
    ).toBe(true);
    expect(
      isComplement(
        containsPack,
        doc("want", { tags: ["a"] }),
        doc("offer", { tag: "z" }),
      ),
    ).toBe(false);
  });
});

describe("json schemas", () => {
  it("validate fixtures", () => {
    const intentSchema = loadSchema("intent-document.json");
    const packSchema = loadSchema("schema-pack.json");
    const querySchema = loadSchema("complement-query.json");
    const resultSchema = loadSchema("query-result.json");
    const verbSchema = loadSchema("verb-envelope.json");
    const mandateSchema = loadSchema("mandate.json");
    const sheetSchema = loadSchema("term-sheet.json");
    expect(ajv.validate(packSchema, {
      id: "iep:exchange.v0",
      version: "0.1.0",
      roles: { alpha: "want", beta: "offer" },
      public_fields: ["category"],
      sealed_fields: ["reserve"],
      term_keys: ["price"],
      terms: { price: { type: "number" } },
      complement: [{ field_a: "category", field_b: "category", op: "eq" }],
    })).toBe(true);
    expect(ajv.validate(intentSchema, {
      id: "11111111-1111-4111-8111-111111111111",
      iep: "0.2",
      schema: "iep:exchange.v0",
      role: "want",
      principal_did: "did:key:z",
      agent_did: "did:key:z",
      agent_card: "http://127.0.0.1:41241/.well-known/agent-card.json",
      public_body: { category: "widget" },
      commit_sealed: "a".repeat(64),
      commit_public: "b".repeat(64),
      mandate_cid: "mandate:local:v0",
      discovery_providers: ["http://127.0.0.1:8787"],
      expires_at: "2030-01-01T00:00:00.000Z",
      signature: "sig",
    })).toBe(true);
    expect(ajv.validate(querySchema, {
      schema: "iep:exchange.v0",
      seeking_role: "offer",
      my_intent_id: "11111111-1111-4111-8111-111111111111",
    })).toBe(true);
    expect(ajv.validate(resultSchema, {
      intents: [{
        id: "11111111-1111-4111-8111-111111111111",
        public_body: {},
        agent_card: "http://127.0.0.1:1/card",
      }],
      cursor: null,
    })).toBe(true);
    expect(ajv.validate(verbSchema, {
      iep: "0.2",
      verb: "ping",
      from_intent: "11111111-1111-4111-8111-111111111111",
      to_intent: "22222222-2222-4222-8222-222222222222",
      nonce: "n",
      ts: "2030-01-01T00:00:00.000Z",
      body: {},
      signature: "sig",
    })).toBe(true);
    expect(ajv.validate(mandateSchema, {
      principal_did: "did:key:z",
      agent_did: "did:key:a",
      grants: ["publish", "reveal", "propose", "ratify"],
      ping_cap: 3,
      expires_at: "2030-01-01T00:00:00.000Z",
      reveal: { price: { min: 30, max: 55 } },
      limits: { price: { max: 60 } },
      signature: "sig",
    })).toBe(true);
    expect(ajv.validate(sheetSchema, {
      session_id: "a".repeat(64),
      schema: "iep:exchange.v0",
      round: 1,
      alpha_intent: "11111111-1111-4111-8111-111111111111",
      beta_intent: "22222222-2222-4222-8222-222222222222",
      terms: { price: 50, start_at: "2026-11-01T00:00:00.000Z" },
    })).toBe(true);
  });
});

describe("sealed leak", () => {
  it("throws IEP_SEALED_LEAK", () => {
    const pack: SchemaPack = {
      id: "iep:exchange.v0",
      version: "0.1.0",
      roles: { alpha: "want", beta: "offer" },
      public_fields: [],
      sealed_fields: ["reserve"],
      term_keys: [],
      complement: [{ field_a: "category", field_b: "category", op: "eq" }],
    };
    expect(() => assertNoSealedLeak(pack, { reserve: 1 })).toThrow(IepError);
    try {
      assertNoSealedLeak(pack, { reserve: 1 });
    } catch (error) {
      expect(error).toBeInstanceOf(IepError);
      expect((error as IepError).code).toBe(ERROR_CODES.IEP_SEALED_LEAK);
    }
    expect(() => parseIntentDocument({ iep: "0.1" })).toThrow(IepError);
  });
});
