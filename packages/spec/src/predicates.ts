import type { ComplementOp, IntentDocument, JsonValue, SchemaPack, TimeRange } from "./types.js";

const asObject = (value: JsonValue | undefined): Record<string, JsonValue> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
};

const asStringArray = (value: JsonValue | undefined): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  if (!value.every((item) => typeof item === "string")) {
    return null;
  }
  return value;
};

const asRange = (value: JsonValue | undefined): TimeRange | null => {
  const object = asObject(value);
  if (!object) {
    return null;
  }
  const start = object["start"];
  const end = object["end"];
  if (typeof start !== "string" || typeof end !== "string") {
    return null;
  }
  return { start, end };
};

const applyOp = (op: ComplementOp, left: JsonValue | undefined, right: JsonValue | undefined): boolean => {
  if (left === undefined || right === undefined) {
    return false;
  }
  switch (op) {
    case "eq":
      return JSON.stringify(left) === JSON.stringify(right);
    case "intersects": {
      const a = asStringArray(left);
      const b = asStringArray(right);
      if (!a || !b) {
        return false;
      }
      const set = new Set(b);
      return a.some((item) => set.has(item));
    }
    case "contains": {
      if (typeof left === "string" && typeof right === "string") {
        return left.includes(right);
      }
      const arr = asStringArray(left);
      return arr !== null && typeof right === "string" && arr.includes(right);
    }
    case "range_overlap": {
      const a = asRange(left);
      const b = asRange(right);
      if (!a || !b) {
        return false;
      }
      const aStart = Date.parse(a.start);
      const aEnd = Date.parse(a.end);
      const bStart = Date.parse(b.start);
      const bEnd = Date.parse(b.end);
      if ([aStart, aEnd, bStart, bEnd].some((n) => Number.isNaN(n))) {
        return false;
      }
      return aStart <= bEnd && bStart <= aEnd;
    }
    default:
      return false;
  }
};

const roleOf = (pack: SchemaPack, doc: IntentDocument): "alpha" | "beta" | null => {
  if (doc.schema !== pack.id) {
    return null;
  }
  if (doc.role === pack.roles.alpha) {
    return "alpha";
  }
  if (doc.role === pack.roles.beta) {
    return "beta";
  }
  return null;
};

export const isComplement = (
  pack: SchemaPack,
  docA: IntentDocument,
  docB: IntentDocument,
): boolean => {
  const roleA = roleOf(pack, docA);
  const roleB = roleOf(pack, docB);
  if (!roleA || !roleB || roleA === roleB) {
    return false;
  }
  const alpha = roleA === "alpha" ? docA : docB;
  const beta = roleA === "beta" ? docA : docB;
  for (const rule of pack.complement) {
    const left = alpha.public_body[rule.field_a];
    const right = beta.public_body[rule.field_b];
    if (!applyOp(rule.op, left, right)) {
      return false;
    }
  }
  return true;
};
