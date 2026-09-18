import { stripSignature } from "./canonicalize.js";
import { verifyDidSignature } from "./crypto.js";
import { ERROR_CODES, IepError } from "./errors.js";
import {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_TOLERANCE,
  IEP_VERSION,
  type ComplementQuery,
  type IntentDocument,
  type JsonObject,
  type Mandate,
  type MandateGrant,
  type ProposeBody,
  type Range,
  type RatifyBody,
  type RejectBody,
  type RevealBody,
  type SchemaPack,
  type TermLimit,
  type TermSheet,
  type VerbEnvelope,
  type VerbName,
  type WithdrawRequest,
} from "./types.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HEX64_RE = /^[0-9a-f]{64}$/u;
const VERBS: readonly VerbName[] = ["ping", "accept", "reject", "reveal", "propose", "ratify"];
const GRANTS: readonly MandateGrant[] = [
  "publish",
  "query",
  "ping",
  "accept",
  "reject",
  "reveal",
  "propose",
  "ratify",
];

const isObject = (value: unknown): value is JsonObject => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

export const assertNoSealedLeak = (pack: SchemaPack, publicBody: JsonObject): void => {
  for (const key of pack.sealed_fields) {
    if (Object.hasOwn(publicBody, key)) {
      throw new IepError(
        ERROR_CODES.IEP_SEALED_LEAK,
        `sealed field "${key}" must not appear on the public document`,
      );
    }
  }
};

export const parseIntentDocument = (value: unknown): IntentDocument => {
  if (!isObject(value)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "intent document must be an object");
  }
  if (value["iep"] !== IEP_VERSION) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "unsupported iep version");
  }
  const id = value["id"];
  const schema = value["schema"];
  const role = value["role"];
  const principal_did = value["principal_did"];
  const agent_did = value["agent_did"];
  const agent_card = value["agent_card"];
  const public_body = value["public_body"];
  const commit_sealed = value["commit_sealed"];
  const commit_public = value["commit_public"];
  const mandate_cid = value["mandate_cid"];
  const discovery_providers = value["discovery_providers"];
  const expires_at = value["expires_at"];
  const signature = value["signature"];
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "id must be a uuid");
  }
  if (!isString(schema) || !isString(role) || !isString(principal_did) || !isString(agent_did)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "missing identity fields");
  }
  if (typeof agent_card !== "string" || !/^https?:\/\//u.test(agent_card)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "agent_card must be an http(s) url");
  }
  if (!isObject(public_body)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "public_body must be an object");
  }
  if (typeof commit_sealed !== "string" || !HEX64_RE.test(commit_sealed)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "commit_sealed must be sha256 hex");
  }
  if (typeof commit_public !== "string" || !HEX64_RE.test(commit_public)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "commit_public must be sha256 hex");
  }
  if (!isString(mandate_cid) || !isString(expires_at) || !isString(signature)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "missing mandate, expiry, or signature");
  }
  if (!Array.isArray(discovery_providers) || !discovery_providers.every((item) => typeof item === "string")) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "discovery_providers must be strings");
  }
  return {
    id,
    iep: IEP_VERSION,
    schema,
    role,
    principal_did,
    agent_did,
    agent_card,
    public_body,
    commit_sealed,
    commit_public,
    mandate_cid,
    discovery_providers,
    expires_at,
    signature,
  };
};

export const parseComplementQuery = (value: unknown): ComplementQuery => {
  if (!isObject(value)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "query must be an object");
  }
  const schema = value["schema"];
  const seeking_role = value["seeking_role"];
  if (!isString(schema) || !isString(seeking_role)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "schema and seeking_role are required");
  }
  const my_intent_id = value["my_intent_id"];
  const public_body = value["public_body"];
  if (typeof my_intent_id !== "string" && !isObject(public_body)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "my_intent_id or public_body is required");
  }
  const query: ComplementQuery = { schema, seeking_role };
  if (typeof my_intent_id === "string") {
    query.my_intent_id = my_intent_id;
  }
  if (isObject(public_body)) {
    query.public_body = public_body;
  }
  if (typeof value["cursor"] === "string") {
    query.cursor = value["cursor"];
  }
  if (typeof value["limit"] === "number") {
    query.limit = value["limit"];
  }
  return query;
};

export const parseVerbEnvelope = (value: unknown): VerbEnvelope => {
  if (!isObject(value)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "verb envelope must be an object");
  }
  const verb = value["verb"];
  if (typeof verb !== "string" || !VERBS.includes(verb as VerbName)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "unknown verb");
  }
  if (value["iep"] !== IEP_VERSION) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "unsupported iep version");
  }
  const from_intent = value["from_intent"];
  const to_intent = value["to_intent"];
  const nonce = value["nonce"];
  const ts = value["ts"];
  const body = value["body"];
  const signature = value["signature"];
  if (typeof from_intent !== "string" || !UUID_RE.test(from_intent)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "from_intent must be a uuid");
  }
  if (typeof to_intent !== "string" || !UUID_RE.test(to_intent)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "to_intent must be a uuid");
  }
  if (!isString(nonce) || !isString(ts) || !isString(signature) || !isObject(body)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "invalid verb envelope fields");
  }
  return { iep: IEP_VERSION, verb: verb as VerbName, from_intent, to_intent, nonce, ts, body, signature };
};

export const parseWithdrawRequest = (value: unknown, id: string): WithdrawRequest => {
  if (!isObject(value)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "withdraw body must be an object");
  }
  const ts = value["ts"];
  const signature = value["signature"];
  if (!isString(ts) || !isString(signature)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "withdraw requires ts and signature");
  }
  return { method: "DELETE", id, ts, signature };
};

const parseRange = (value: unknown, label: string): Range => {
  if (!isObject(value) || !isFiniteNumber(value["min"]) || !isFiniteNumber(value["max"])) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, `${label} must be {min, max}`);
  }
  if (value["min"] > value["max"]) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, `${label} min must be <= max`);
  }
  return { min: value["min"], max: value["max"] };
};

const parseTermLimit = (value: unknown): TermLimit => {
  if (!isObject(value)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "limits.price must be an object");
  }
  const limit: TermLimit = {};
  if (isFiniteNumber(value["min"])) {
    limit.min = value["min"];
  }
  if (isFiniteNumber(value["max"])) {
    limit.max = value["max"];
  }
  if (limit.min !== undefined && limit.max !== undefined && limit.min > limit.max) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "limits.price min must be <= max");
  }
  return limit;
};

export const parseTermSheet = (value: unknown): TermSheet => {
  if (!isObject(value)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "term sheet must be an object");
  }
  const session_id = value["session_id"];
  const schema = value["schema"];
  const round = value["round"];
  const alpha_intent = value["alpha_intent"];
  const beta_intent = value["beta_intent"];
  const terms = value["terms"];
  if (typeof session_id !== "string" || !HEX64_RE.test(session_id)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "term sheet session_id must be sha256 hex");
  }
  if (!isString(schema)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "term sheet schema is required");
  }
  if (typeof round !== "number" || !Number.isInteger(round) || round < 1) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "term sheet round must be a positive integer");
  }
  if (typeof alpha_intent !== "string" || !UUID_RE.test(alpha_intent)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "alpha_intent must be a uuid");
  }
  if (typeof beta_intent !== "string" || !UUID_RE.test(beta_intent)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "beta_intent must be a uuid");
  }
  if (!isObject(terms) || !isFiniteNumber(terms["price"]) || typeof terms["start_at"] !== "string") {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "term sheet terms must include price and start_at");
  }
  return {
    session_id,
    schema,
    round,
    alpha_intent,
    beta_intent,
    terms: { price: terms["price"], start_at: terms["start_at"] },
  };
};

export const parseRevealBody = (value: unknown): RevealBody => {
  if (!isObject(value)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "reveal body must be an object");
  }
  const session_id = value["session_id"];
  if (typeof session_id !== "string" || !HEX64_RE.test(session_id)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "reveal session_id must be sha256 hex");
  }
  if (value["stage"] !== "ranges") {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "v0.2 reveal stage must be ranges");
  }
  const terms = value["terms"];
  if (!isObject(terms)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "reveal terms must be an object");
  }
  return { session_id, stage: "ranges", terms: { price: parseRange(terms["price"], "reveal.terms.price") } };
};

export const parseProposeBody = (value: unknown): ProposeBody => {
  if (!isObject(value)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "propose body must be an object");
  }
  const session_id = value["session_id"];
  if (typeof session_id !== "string" || !HEX64_RE.test(session_id)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "propose session_id must be sha256 hex");
  }
  const term_sheet = parseTermSheet(value["term_sheet"]);
  if (term_sheet.session_id !== session_id) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "term sheet session_id mismatch");
  }
  return { session_id, term_sheet };
};

export const parseRatifyBody = (value: unknown): RatifyBody => {
  if (!isObject(value)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "ratify body must be an object");
  }
  const session_id = value["session_id"];
  const term_sheet_hash = value["term_sheet_hash"];
  const principal_did = value["principal_did"];
  const ts = value["ts"];
  const principal_signature = value["principal_signature"];
  if (typeof session_id !== "string" || !HEX64_RE.test(session_id)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "ratify session_id must be sha256 hex");
  }
  if (typeof term_sheet_hash !== "string" || !HEX64_RE.test(term_sheet_hash)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "term_sheet_hash must be sha256 hex");
  }
  if (!isString(principal_did) || !isString(ts) || !isString(principal_signature)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "ratify is missing principal fields");
  }
  return { session_id, term_sheet_hash, principal_did, ts, principal_signature };
};

export const parseRejectBody = (value: unknown): RejectBody => {
  if (!isObject(value)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "reject body must be an object");
  }
  const session_id = value["session_id"];
  const reason = value["reason"];
  if (typeof session_id !== "string" || !HEX64_RE.test(session_id)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "reject session_id must be sha256 hex");
  }
  if (!isString(reason)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "reject reason is required");
  }
  return { session_id, reason };
};

export const parseMandate = (value: unknown): Mandate => {
  if (!isObject(value)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_MANDATE, "mandate must be an object");
  }
  const principal_did = value["principal_did"];
  const agent_did = value["agent_did"];
  const grants = value["grants"];
  const ping_cap = value["ping_cap"];
  const expires_at = value["expires_at"];
  const signature = value["signature"];
  const reveal = value["reveal"];
  const limits = value["limits"];
  if (!isString(principal_did) || !isString(agent_did) || !isString(expires_at) || !isString(signature)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_MANDATE, "mandate is missing identity or signature");
  }
  if (!Array.isArray(grants) || grants.some((grant) => typeof grant !== "string" || !GRANTS.includes(grant as MandateGrant))) {
    throw new IepError(ERROR_CODES.IEP_INVALID_MANDATE, "mandate grants are invalid");
  }
  if (typeof ping_cap !== "number" || !Number.isInteger(ping_cap) || ping_cap < 0) {
    throw new IepError(ERROR_CODES.IEP_INVALID_MANDATE, "ping_cap must be a non-negative integer");
  }
  if (!isObject(reveal) || !isObject(limits)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_MANDATE, "mandate must include reveal and limits");
  }
  const mandate: Mandate = {
    principal_did,
    agent_did,
    grants: grants as MandateGrant[],
    ping_cap,
    expires_at,
    reveal: { price: parseRange(reveal["price"], "mandate.reveal.price") },
    limits: { price: parseTermLimit(limits["price"]) },
    signature,
  };
  if (typeof value["max_rounds"] === "number") {
    if (!Number.isInteger(value["max_rounds"]) || value["max_rounds"] < 1) {
      throw new IepError(ERROR_CODES.IEP_INVALID_MANDATE, "max_rounds must be a positive integer");
    }
    mandate.max_rounds = value["max_rounds"];
  }
  if (typeof value["tolerance"] === "number") {
    if (!Number.isFinite(value["tolerance"]) || value["tolerance"] < 0) {
      throw new IepError(ERROR_CODES.IEP_INVALID_MANDATE, "tolerance must be a non-negative number");
    }
    mandate.tolerance = value["tolerance"];
  }
  return mandate;
};

export const mandateMaxRounds = (mandate: Mandate): number => mandate.max_rounds ?? DEFAULT_MAX_ROUNDS;
export const mandateTolerance = (mandate: Mandate): number => mandate.tolerance ?? DEFAULT_TOLERANCE;

export const verifyMandate = async (mandate: Mandate, agentDid: string): Promise<void> => {
  if (mandate.agent_did !== agentDid) {
    throw new IepError(ERROR_CODES.IEP_INVALID_MANDATE, "mandate agent_did does not match agent");
  }
  if (Date.parse(mandate.expires_at) <= Date.now()) {
    throw new IepError(ERROR_CODES.IEP_MANDATE_DENIED, "mandate expired");
  }
  const ok = await verifyDidSignature(stripSignature(mandate), mandate.signature, mandate.principal_did);
  if (!ok) {
    throw new IepError(ERROR_CODES.IEP_INVALID_MANDATE, "mandate signature is invalid");
  }
};

export const assertWithinReveal = (mandate: Mandate, terms: RevealBody["terms"]): void => {
  const allowed = mandate.reveal.price;
  const revealed = terms.price;
  if (revealed.min < allowed.min || revealed.max > allowed.max) {
    throw new IepError(ERROR_CODES.IEP_TERM_OUT_OF_BOUNDS, "reveal band exceeds mandate.reveal");
  }
};

export const assertWithinLimits = (mandate: Mandate, terms: TermSheet["terms"]): void => {
  const limit = mandate.limits.price;
  if (limit.min !== undefined && terms.price < limit.min) {
    throw new IepError(ERROR_CODES.IEP_TERM_OUT_OF_BOUNDS, "price is below mandate limit");
  }
  if (limit.max !== undefined && terms.price > limit.max) {
    throw new IepError(ERROR_CODES.IEP_TERM_OUT_OF_BOUNDS, "price is above mandate limit");
  }
};

export const assertTermKeys = (pack: SchemaPack, terms: JsonObject): void => {
  const keys = Object.keys(terms).sort();
  const expected = [...pack.term_keys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "term sheet keys must match the schema pack");
  }
};

export const assertPriceInZone = (zone: Range, price: number): void => {
  if (price < zone.min || price > zone.max) {
    throw new IepError(ERROR_CODES.IEP_TERM_OUT_OF_BOUNDS, "price is outside the revealed zone");
  }
};

export const assertNotExpired = (expiresAt: string, now = Date.now()): void => {
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms) || ms <= now) {
    throw new IepError(ERROR_CODES.IEP_EXPIRED, "intent is expired");
  }
};

export const authorize = (mandate: Mandate, grant: Mandate["grants"][number]): void => {
  if (Date.parse(mandate.expires_at) <= Date.now()) {
    throw new IepError(ERROR_CODES.IEP_MANDATE_DENIED, "mandate expired");
  }
  if (!mandate.grants.includes(grant)) {
    throw new IepError(ERROR_CODES.IEP_MANDATE_DENIED, `mandate does not grant ${grant}`);
  }
};
