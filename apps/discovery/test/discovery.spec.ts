import { FEASIBILITY_MATRIX, OFFER_1, PACK_ZERO_ID, WANT_1, WANT_2 } from "@iep/pack-zero";
import {
  commit,
  generateKeyPair,
  signCanonical,
  signDocument,
  type IntentDocument,
  type UnsignedIntentDocument,
} from "@intentexchange/spec";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index.js";

beforeAll(async () => {
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY, schema_id TEXT NOT NULL, role TEXT NOT NULL, category TEXT NOT NULL, agent_did TEXT NOT NULL, principal_did TEXT NOT NULL DEFAULT '', agent_card TEXT NOT NULL, public_body TEXT NOT NULL, commit_sealed TEXT NOT NULL, commit_public TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);",
  );
  await env.DB.exec(
    "CREATE INDEX IF NOT EXISTS idx_intents_partition ON intents (schema_id, role, category, expires_at);",
  );
});

const fetchWorker = async (request: Request): Promise<Response> => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
};

const signIntent = async (
  keys: Awaited<ReturnType<typeof generateKeyPair>>,
  base: IntentDocument,
): Promise<IntentDocument> => {
  const unsigned: UnsignedIntentDocument = {
    ...base,
    principal_did: keys.did,
    agent_did: keys.did,
    commit_public: await commit(base.public_body),
    commit_sealed: await commit({ reserve: 1 }),
    expires_at: "2030-01-01T00:00:00.000Z",
  };
  return signDocument<IntentDocument>(unsigned, keys.privateKeyPkcs8);
};

describe("discovery provider", () => {
  it("serves a service document and health", async () => {
    const root = await fetchWorker(new Request("http://discovery/"));
    expect(root.status).toBe(200);
    expect(await root.json()).toMatchObject({ service: "iep-discovery", iep: "0.2" });
    const health = await fetchWorker(
      new Request("http://discovery/v0/health", {
        headers: { Origin: "https://intentexchange.dev" },
      }),
    );
    expect(health.status).toBe(200);
    expect(health.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rejects sealed fields on publish", async () => {
    const keys = await generateKeyPair();
    const leaked = await signIntent(keys, {
      ...WANT_1,
      public_body: { ...WANT_1.public_body, reserve: 99 },
    });
    const response = await fetchWorker(
      new Request("http://discovery/v0/intents", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(leaked),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "IEP_SEALED_LEAK" });
  });

  it("rejects a bad signature", async () => {
    const keys = await generateKeyPair();
    const other = await generateKeyPair();
    const unsigned: UnsignedIntentDocument = {
      ...WANT_1,
      principal_did: keys.did,
      agent_did: keys.did,
      commit_public: await commit(WANT_1.public_body),
      commit_sealed: await commit({ reserve: 1 }),
      expires_at: "2030-01-01T00:00:00.000Z",
    };
    const signed = await signDocument<IntentDocument>(unsigned, other.privateKeyPkcs8);
    const response = await fetchWorker(
      new Request("http://discovery/v0/intents", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signed),
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "IEP_INVALID_SIGNATURE" });
  });

  it("publishes and returns only feasible complements", async () => {
    const wantKeys = await generateKeyPair();
    const offerKeys = await generateKeyPair();
    const want = await signIntent(wantKeys, WANT_1);
    const offer = await signIntent(offerKeys, OFFER_1);
    const want2 = await signIntent(wantKeys, WANT_2);

    for (const doc of [want, offer, want2]) {
      const put = await fetchWorker(
        new Request("http://discovery/v0/intents", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(doc),
        }),
      );
      expect(put.status, await put.text()).toBe(201);
    }

    const schema = await fetchWorker(
      new Request(`http://discovery/v0/schemas/${encodeURIComponent(PACK_ZERO_ID)}`),
    );
    expect(schema.status).toBe(200);

    const query = await fetchWorker(
      new Request("http://discovery/v0/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schema: PACK_ZERO_ID,
          seeking_role: "offer",
          my_intent_id: want.id,
        }),
      }),
    );
    expect(query.status).toBe(200);
    const body = (await query.json()) as { intents: { id: string }[] };
    expect(body.intents.map((item) => item.id)).toEqual(
      FEASIBILITY_MATRIX[0]![0] ? [offer.id] : [],
    );
    expect("score" in body).toBe(false);
    expect(body.intents[0] && "score" in body.intents[0]).toBe(false);

    const withdrawTs = new Date().toISOString();
    const signature = await signCanonical(
      { method: "DELETE", id: want2.id, ts: withdrawTs },
      wantKeys.privateKeyPkcs8,
    );
    const del = await fetchWorker(
      new Request(`http://discovery/v0/intents/${want2.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ts: withdrawTs, signature }),
      }),
    );
    expect(del.status).toBe(200);
  });
});
