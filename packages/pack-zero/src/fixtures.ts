import { IEP_VERSION, type IntentDocument, type JsonObject, type UnsignedMandate } from "@intentexchange/spec";
import { PACK_ZERO } from "./pack.js";

const placeholder = (
  id: string,
  role: "want" | "offer",
  publicBody: JsonObject,
): IntentDocument => ({
  id,
  iep: IEP_VERSION,
  schema: PACK_ZERO.id,
  role,
  principal_did: "did:key:fixture",
  agent_did: "did:key:fixture",
  agent_card: "http://127.0.0.1:1/.well-known/agent-card.json",
  public_body: publicBody,
  commit_sealed: "0".repeat(64),
  commit_public: "1".repeat(64),
  mandate_cid: "mandate:fixture",
  discovery_providers: ["http://127.0.0.1:8787"],
  expires_at: "2030-01-01T00:00:00.000Z",
  signature: "fixture",
});

export const WANT_1 = placeholder("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "want", {
  category: "widget",
  regions: ["eu", "us"],
  window: { start: "2026-10-01T00:00:00.000Z", end: "2026-12-31T00:00:00.000Z" },
  summary: "looking for a widget in eu/us fall 2026",
});

export const WANT_2 = placeholder("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "want", {
  category: "gadget",
  regions: ["apac"],
  window: { start: "2026-01-01T00:00:00.000Z", end: "2026-03-31T00:00:00.000Z" },
  summary: "looking for a gadget in apac q1",
});

export const WANT_3 = placeholder("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", "want", {
  category: "widget",
  regions: ["us"],
  window: { start: "2027-01-01T00:00:00.000Z", end: "2027-02-01T00:00:00.000Z" },
  summary: "widget in us early 2027",
});

export const OFFER_1 = placeholder("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", "offer", {
  category: "widget",
  regions: ["eu"],
  window: { start: "2026-11-01T00:00:00.000Z", end: "2026-11-30T00:00:00.000Z" },
  summary: "widget available in eu november",
});

export const OFFER_2 = placeholder("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", "offer", {
  category: "gadget",
  regions: ["apac"],
  window: { start: "2026-02-01T00:00:00.000Z", end: "2026-02-15T00:00:00.000Z" },
  summary: "gadget available in apac february",
});

export const OFFER_3 = placeholder("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", "offer", {
  category: "widget",
  regions: ["latam"],
  window: { start: "2026-11-01T00:00:00.000Z", end: "2026-11-30T00:00:00.000Z" },
  summary: "widget available in latam november",
});

export const WANTS = [WANT_1, WANT_2, WANT_3];
export const OFFERS = [OFFER_1, OFFER_2, OFFER_3];

/** Rows: wants 1..3, columns: offers 1..3 */
export const FEASIBILITY_MATRIX: boolean[][] = [
  [true, false, false],
  [false, true, false],
  [false, false, false],
];

const SESSION_GRANTS: UnsignedMandate["grants"] = [
  "publish",
  "query",
  "ping",
  "accept",
  "reject",
  "reveal",
  "propose",
  "ratify",
];

export const WANT_MANDATE: Omit<UnsignedMandate, "principal_did" | "agent_did"> = {
  grants: SESSION_GRANTS,
  ping_cap: 3,
  expires_at: "2030-01-01T00:00:00.000Z",
  reveal: { price: { min: 30, max: 55 } },
  limits: { price: { max: 60 } },
  max_rounds: 8,
  tolerance: 1,
};

export const OFFER_MANDATE: Omit<UnsignedMandate, "principal_did" | "agent_did"> = {
  grants: SESSION_GRANTS,
  ping_cap: 3,
  expires_at: "2030-01-01T00:00:00.000Z",
  reveal: { price: { min: 45, max: 80 } },
  limits: { price: { min: 40 } },
  max_rounds: 8,
  tolerance: 1,
};

export const WANT_MANDATE_NO_ZONE: Omit<UnsignedMandate, "principal_did" | "agent_did"> = {
  ...WANT_MANDATE,
  reveal: { price: { min: 10, max: 20 } },
};

export const OFFER_MANDATE_NO_ZONE: Omit<UnsignedMandate, "principal_did" | "agent_did"> = {
  ...OFFER_MANDATE,
};
