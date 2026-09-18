import type { SchemaPack } from "@intentexchange/spec";

export const PACK_ZERO_ID = "iep:exchange.v0";

export const PACK_ZERO: SchemaPack = {
  id: PACK_ZERO_ID,
  version: "0.1.0",
  roles: { alpha: "want", beta: "offer" },
  public_fields: ["category", "regions", "window", "summary"],
  sealed_fields: ["reserve"],
  term_keys: ["price", "start_at"],
  terms: {
    price: { type: "number" },
    start_at: { type: "date-time" },
  },
  complement: [
    { field_a: "category", field_b: "category", op: "eq" },
    { field_a: "regions", field_b: "regions", op: "intersects" },
    { field_a: "window", field_b: "window", op: "range_overlap" },
  ],
};

export type ExchangePublicBody = {
  category: "widget" | "gadget";
  regions: string[];
  window: { start: string; end: string };
  summary: string;
};

export type ExchangeSealedBody = {
  reserve: number;
};

export const PACK_ZERO_CATEGORIES = ["widget", "gadget"] as const;
