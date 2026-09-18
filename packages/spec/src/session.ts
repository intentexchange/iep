import { ERROR_CODES, IepError } from "./errors.js";
import { TS_SKEW_MS, type SessionState, type VerbName } from "./types.js";

export type TransitionDirection = "in" | "out";

const illegal = (state: SessionState, verb: VerbName): never => {
  throw new IepError(ERROR_CODES.IEP_SESSION_STATE, `cannot apply ${verb} in state ${state}`);
};

export const transition = (
  state: SessionState,
  verb: VerbName,
  _direction: TransitionDirection,
): SessionState => {
  if (state === "ratified" || state === "rejected") {
    throw new IepError(ERROR_CODES.IEP_SESSION_STATE, "session is terminal");
  }
  if (verb === "reject") {
    return "rejected";
  }
  if (verb === "ping" || verb === "accept") {
    if (state === "handshook") {
      return "handshook";
    }
    return illegal(state, verb);
  }
  switch (state) {
    case "handshook":
      if (verb === "reveal") {
        return "revealed";
      }
      return illegal(state, verb);
    case "revealed":
      if (verb === "reveal") {
        return "revealed";
      }
      if (verb === "propose") {
        return "bargaining";
      }
      return illegal(state, verb);
    case "bargaining":
      if (verb === "propose") {
        return "bargaining";
      }
      if (verb === "ratify") {
        return "ratifying";
      }
      return illegal(state, verb);
    case "ratifying":
      if (verb === "ratify") {
        return "ratified";
      }
      return illegal(state, verb);
    default:
      return illegal(state, verb);
  }
};

export const assertFreshTs = (ts: string, now = Date.now()): void => {
  const ms = Date.parse(ts);
  if (Number.isNaN(ms) || Math.abs(ms - now) > TS_SKEW_MS) {
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "verb timestamp outside allowed skew");
  }
};

export const rememberNonce = (seen: Set<string>, nonce: string): void => {
  if (seen.has(nonce)) {
    throw new IepError(ERROR_CODES.IEP_REPLAY, "nonce already used in this session");
  }
  seen.add(nonce);
};
