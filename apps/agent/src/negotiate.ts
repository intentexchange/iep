import { mandateMaxRounds, mandateTolerance, type Mandate, type Range } from "@iep/spec";

export type AgentSide = "want" | "offer";

export type Decision =
  | { kind: "propose"; price: number }
  | { kind: "accept" }
  | { kind: "reject"; reason: "no_agreement" };

export const roundPrice = (value: number): number => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

export const intersectRanges = (a: Range, b: Range): Range | null => {
  const min = Math.max(a.min, b.min);
  const max = Math.min(a.max, b.max);
  if (min > max) {
    return null;
  }
  return { min, max };
};

export const openingPrice = (role: AgentSide, zone: Range): number => {
  return role === "want" ? zone.min : zone.max;
};

export const nextPrice = (mine: number, theirs: number): number => {
  return roundPrice(mine + 0.5 * (theirs - mine));
};

export const deriveStartAt = (ownStart: string, peerStart: string): string => {
  return Date.parse(ownStart) >= Date.parse(peerStart) ? ownStart : peerStart;
};

export const windowStartOf = (publicBody: { readonly [key: string]: unknown }): string => {
  const window = publicBody["window"];
  if (!window || typeof window !== "object" || Array.isArray(window)) {
    throw new Error("public body is missing window.start");
  }
  const start = (window as { start?: unknown }).start;
  if (typeof start !== "string") {
    throw new Error("public body is missing window.start");
  }
  return start;
};

export const clampToLimits = (price: number, mandate: Mandate): number => {
  let next = price;
  if (mandate.limits.price.min !== undefined) {
    next = Math.max(next, mandate.limits.price.min);
  }
  if (mandate.limits.price.max !== undefined) {
    next = Math.min(next, mandate.limits.price.max);
  }
  return roundPrice(next);
};

export const decide = (input: {
  role: AgentSide;
  zone: Range;
  mine?: number;
  theirs?: number;
  nextRound: number;
  mandate: Mandate;
}): Decision => {
  if (input.nextRound > mandateMaxRounds(input.mandate)) {
    return { kind: "reject", reason: "no_agreement" };
  }
  const raw =
    input.mine === undefined
      ? openingPrice(input.role, input.zone)
      : nextPrice(input.mine, input.theirs ?? input.mine);
  const next = clampToLimits(raw, input.mandate);
  const tolerance = mandateTolerance(input.mandate);
  if (input.theirs !== undefined && Math.abs(input.theirs - next) <= tolerance) {
    return { kind: "accept" };
  }
  if (next < input.zone.min || next > input.zone.max) {
    return { kind: "reject", reason: "no_agreement" };
  }
  return { kind: "propose", price: next };
};
