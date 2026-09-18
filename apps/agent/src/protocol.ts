import {
  PACK_ZERO,
  PACK_ZERO_ID,
} from "@iep/pack-zero";
import {
  assertFreshTs,
  assertPriceInZone,
  assertTermKeys,
  dealId,
  ERROR_CODES,
  IepError,
  IEP_VERSION,
  parseProposeBody,
  parseRatifyBody,
  parseRejectBody,
  parseRevealBody,
  rememberNonce,
  stripSignature,
  termSheetHash,
  transition,
  verifyDidSignature,
  verifyRatification,
  type JsonObject,
  type ProposeBody,
  type Range,
  type Ratification,
  type RatifyBody,
  type RevealBody,
  type TermSheet,
  type VerbEnvelope,
} from "@iep/spec";
import { deriveStartAt, intersectRanges, windowStartOf } from "./negotiate.js";
import type { SessionEntry } from "./session-store.js";
import type { AgentRole } from "./types.js";

export const asJsonObject = (value: object): JsonObject => value as JsonObject;

export const envelopePayload = (envelope: VerbEnvelope): Omit<VerbEnvelope, "signature"> => {
  return stripSignature(envelope);
};

export const verifyPeerEnvelope = async (
  envelope: VerbEnvelope,
  peerDid: string,
  ownIntentId: string,
): Promise<void> => {
  assertFreshTs(envelope.ts);
  if (envelope.to_intent !== ownIntentId) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "verb is not addressed to this intent");
  }
  const valid = await verifyDidSignature(envelopePayload(envelope), envelope.signature, peerDid);
  if (!valid) {
    throw new IepError(ERROR_CODES.IEP_INVALID_SIGNATURE, `${envelope.verb} signature invalid`);
  }
};

export const consumeNonce = (session: SessionEntry, nonce: string): void => {
  rememberNonce(session.nonces, nonce);
};

export const applyOutbound = (session: SessionEntry, verb: VerbEnvelope["verb"]): void => {
  session.state = transition(session.state, verb, "out");
};

export const termIntents = (
  role: AgentRole,
  ownIntent: string,
  peerIntent: string,
): { alpha_intent: string; beta_intent: string } => {
  return role === "want"
    ? { alpha_intent: ownIntent, beta_intent: peerIntent }
    : { alpha_intent: peerIntent, beta_intent: ownIntent };
};

export const expectedStartAt = (session: SessionEntry, ownPublicBody: JsonObject): string => {
  return deriveStartAt(windowStartOf(ownPublicBody), windowStartOf(session.peerPublicBody));
};

export const assertSheetParties = (session: SessionEntry, role: AgentRole, sheet: TermSheet): void => {
  const expected = termIntents(role, session.ownIntent, session.peerIntent);
  if (sheet.alpha_intent !== expected.alpha_intent || sheet.beta_intent !== expected.beta_intent) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "term sheet intent ids do not match the session");
  }
  if (sheet.session_id !== session.id) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "term sheet session mismatch");
  }
  if (sheet.schema !== PACK_ZERO_ID) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "term sheet schema mismatch");
  }
};

const refreshZone = (session: SessionEntry): Range | null => {
  if (!session.ownReveal || !session.peerReveal) {
    return session.zone ?? null;
  }
  session.zone = intersectRanges(session.ownReveal, session.peerReveal);
  return session.zone;
};

export const applyReveal = (session: SessionEntry, body: RevealBody, ours: boolean): Range | null => {
  if (body.session_id !== session.id) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "reveal session mismatch");
  }
  if (ours) {
    session.ownReveal = body.terms.price;
  } else {
    session.peerReveal = body.terms.price;
  }
  return refreshZone(session);
};

export const applyPropose = (
  session: SessionEntry,
  body: ProposeBody,
  role: AgentRole,
  ownPublicBody: JsonObject,
  ours: boolean,
): TermSheet => {
  if (body.session_id !== session.id) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "propose session mismatch");
  }
  const sheet = body.term_sheet;
  assertTermKeys(PACK_ZERO, asJsonObject(sheet.terms));
  assertSheetParties(session, role, sheet);
  if (sheet.terms.start_at !== expectedStartAt(session, ownPublicBody)) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "start_at must be max(window.start)");
  }
  if (!session.zone) {
    throw new IepError(ERROR_CODES.IEP_SESSION_STATE, "propose before a zone exists");
  }
  assertPriceInZone(session.zone, sheet.terms.price);
  if (sheet.round !== session.round + 1) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "term sheet round must step by one");
  }
  session.round = sheet.round;
  session.termSheet = sheet;
  if (ours) {
    session.lastMine = sheet.terms.price;
  } else {
    session.lastTheirs = sheet.terms.price;
  }
  return sheet;
};

export const toRatification = (body: RatifyBody): Ratification => ({
  iep: IEP_VERSION,
  session_id: body.session_id,
  term_sheet_hash: body.term_sheet_hash,
  principal_did: body.principal_did,
  ts: body.ts,
  principal_signature: body.principal_signature,
});

export const applyRatify = async (
  session: SessionEntry,
  body: RatifyBody,
  expectedPrincipalDid: string,
  ours: boolean,
): Promise<void> => {
  if (body.session_id !== session.id) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "ratify session mismatch");
  }
  if (body.principal_did !== expectedPrincipalDid) {
    throw new IepError(ERROR_CODES.IEP_INVALID_SIGNATURE, "ratify principal_did mismatch");
  }
  if (!session.termSheet) {
    throw new IepError(ERROR_CODES.IEP_SESSION_STATE, "ratify without a term sheet");
  }
  const hash = await termSheetHash(session.termSheet);
  if (hash !== body.term_sheet_hash) {
    throw new IepError(ERROR_CODES.IEP_COMMIT_MISMATCH, "term_sheet_hash does not match the agreed sheet");
  }
  const ratification = toRatification(body);
  const ok = await verifyRatification(ratification);
  if (!ok) {
    throw new IepError(ERROR_CODES.IEP_INVALID_SIGNATURE, "principal ratification is invalid");
  }
  if (ours) {
    session.ownRatification = ratification;
  } else {
    session.peerRatification = ratification;
  }
};

export const applyReject = (session: SessionEntry, envelope: VerbEnvelope): void => {
  const body = parseRejectBody(envelope.body);
  if (body.session_id !== session.id) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "reject session mismatch");
  }
  session.rejectReason = body.reason;
};

export const maybeSealDeal = async (session: SessionEntry): Promise<void> => {
  if (!session.termSheet || !session.ownRatification || !session.peerRatification) {
    return;
  }
  const hash = await termSheetHash(session.termSheet);
  const left = session.ownRatification;
  const right = session.peerRatification;
  const ordered =
    left.principal_did <= right.principal_did ? [left, right] : [right, left];
  session.deal = {
    deal_id: await dealId(session.id, hash),
    session_id: session.id,
    term_sheet: session.termSheet,
    ratifications: [ordered[0]!, ordered[1]!],
  };
  if (session.state === "ratifying") {
    session.state = "ratified";
  }
};

export const parseInboundBody = (envelope: VerbEnvelope): RevealBody | ProposeBody | RatifyBody | { reason: string; session_id: string } | JsonObject => {
  switch (envelope.verb) {
    case "reveal":
      return parseRevealBody(envelope.body);
    case "propose":
      return parseProposeBody(envelope.body);
    case "ratify":
      return parseRatifyBody(envelope.body);
    case "reject":
      return parseRejectBody(envelope.body);
    default:
      return envelope.body;
  }
};

export { parseRevealBody, parseProposeBody, parseRatifyBody, parseRejectBody };
