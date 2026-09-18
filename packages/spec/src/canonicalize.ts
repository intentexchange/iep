import type { JsonValue } from "./types.js";

/** RFC 8785 JSON Canonicalization Scheme (JCS) subset for JSON values. */
export const canonicalize = (value: unknown): string => {
  return serialize(asJson(value));
};

const asJson = (value: unknown): JsonValue => {
  if (value === undefined) {
    throw new TypeError("undefined cannot be canonicalized");
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("non-finite numbers cannot be canonicalized");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(asJson);
  }
  if (typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested === undefined) {
        continue;
      }
      out[key] = asJson(nested);
    }
    return out;
  }
  throw new TypeError(`unsupported JSON type: ${typeof value}`);
};

const serialize = (value: JsonValue): string => {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${serialize(value[key]!)}`);
  return `{${parts.join(",")}}`;
};

export const stripSignature = <T extends { signature: string }>(
  signed: T,
): Omit<T, "signature"> => {
  const { signature: _signature, ...rest } = signed;
  return rest;
};
