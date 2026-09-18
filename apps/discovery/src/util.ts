import type { IntentDocument } from "@iep/spec";

const WINDOW_MS = 60_000;
const LIMIT = 30;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export const rateLimit = (agentDid: string, now = Date.now()): boolean => {
  const existing = buckets.get(agentDid);
  if (!existing || now >= existing.resetAt) {
    buckets.set(agentDid, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (existing.count >= LIMIT) {
    return false;
  }
  existing.count += 1;
  return true;
};

export const encodeCursor = (createdAt: string, id: string): string => {
  return btoa(`${createdAt}|${id}`);
};

export const decodeCursor = (cursor: string): { createdAt: string; id: string } => {
  const raw = atob(cursor);
  const split = raw.indexOf("|");
  if (split < 0) {
    throw new Error("invalid cursor");
  }
  return { createdAt: raw.slice(0, split), id: raw.slice(split + 1) };
};

export const categoryOf = (doc: IntentDocument): string => {
  const category = doc.public_body["category"];
  if (typeof category !== "string" || category.length === 0) {
    throw new Error("public_body.category is required for partition");
  }
  return category;
};
