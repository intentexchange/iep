export const IEP_VERSION = "0.2" as const;
export const IEP_MEDIA_TYPE = "application/intent+json";
export const IEP_EXTENSION_URI = "https://intentexchange.dev/ext/v0";
export const REFERENCE_DISCOVERY_URL = "https://discovery.intentexchange.dev";

export const DEFAULT_MAX_ROUNDS = 8;
export const DEFAULT_TOLERANCE = 1;
export const TS_SKEW_MS = 5 * 60 * 1000;

export type ComplementOp = "eq" | "intersects" | "contains" | "range_overlap";
export type VerbName = "ping" | "accept" | "reject" | "reveal" | "propose" | "ratify";
export type MandateGrant = "publish" | "query" | "ping" | "accept" | "reject" | "reveal" | "propose" | "ratify";
export type SessionState = "handshook" | "revealed" | "bargaining" | "ratifying" | "ratified" | "rejected";
export type RevealStage = "ranges";
export type TermTypeName = "number" | "date-time" | "string";
export type RejectReason = "no_zone" | "no_agreement" | string;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type TimeRange = {
  start: string;
  end: string;
};

export type Range = {
  min: number;
  max: number;
};

export type TermLimit = {
  min?: number;
  max?: number;
};

export type ComplementRule = {
  field_a: string;
  field_b: string;
  op: ComplementOp;
};

export type TermSchema = {
  type: TermTypeName;
};

export type SchemaPack = {
  id: string;
  version: string;
  roles: { alpha: string; beta: string };
  public_fields: string[];
  sealed_fields: string[];
  term_keys: string[];
  terms?: { [key: string]: TermSchema };
  complement: ComplementRule[];
};

export type IntentDocument = {
  id: string;
  iep: typeof IEP_VERSION;
  schema: string;
  role: string;
  principal_did: string;
  agent_did: string;
  agent_card: string;
  public_body: JsonObject;
  commit_sealed: string;
  commit_public: string;
  mandate_cid: string;
  discovery_providers: string[];
  expires_at: string;
  signature: string;
};

export type UnsignedIntentDocument = Omit<IntentDocument, "signature">;

export type ComplementQuery = {
  schema: string;
  seeking_role: string;
  my_intent_id?: string;
  public_body?: JsonObject;
  cursor?: string;
  limit?: number;
};

export type QueryHit = {
  id: string;
  public_body: JsonObject;
  agent_card: string;
};

export type QueryResult = {
  intents: QueryHit[];
  cursor?: string | null;
};

export type VerbEnvelope = {
  iep: typeof IEP_VERSION;
  verb: VerbName;
  from_intent: string;
  to_intent: string;
  nonce: string;
  ts: string;
  body: JsonObject;
  signature: string;
};

export type UnsignedVerbEnvelope = Omit<VerbEnvelope, "signature">;

export type WithdrawRequest = {
  method: "DELETE";
  id: string;
  ts: string;
  signature: string;
};

export type Mandate = {
  principal_did: string;
  agent_did: string;
  grants: MandateGrant[];
  ping_cap: number;
  expires_at: string;
  reveal: { price: Range };
  limits: { price: TermLimit };
  max_rounds?: number;
  tolerance?: number;
  signature: string;
};

export type UnsignedMandate = Omit<Mandate, "signature">;

export type TermSheet = {
  session_id: string;
  schema: string;
  round: number;
  alpha_intent: string;
  beta_intent: string;
  terms: {
    price: number;
    start_at: string;
  };
};

export type RevealBody = {
  session_id: string;
  stage: RevealStage;
  terms: { price: Range };
};

export type ProposeBody = {
  session_id: string;
  term_sheet: TermSheet;
};

export type RatifyBody = {
  session_id: string;
  term_sheet_hash: string;
  principal_did: string;
  ts: string;
  principal_signature: string;
};

export type RejectBody = {
  session_id: string;
  reason: RejectReason;
};

export type RatificationPayload = {
  iep: typeof IEP_VERSION;
  session_id: string;
  term_sheet_hash: string;
  principal_did: string;
  ts: string;
};

export type Ratification = RatificationPayload & {
  principal_signature: string;
};

export type DealRecord = {
  deal_id: string;
  session_id: string;
  term_sheet: TermSheet;
  ratifications: [Ratification, Ratification];
};
