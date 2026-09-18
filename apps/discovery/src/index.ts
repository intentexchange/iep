import { PACK_ZERO, PACK_ZERO_ID } from "@iep/pack-zero";
import {
  assertNoSealedLeak,
  assertNotExpired,
  commit,
  ERROR_CODES,
  IEP_VERSION,
  IepError,
  isComplement,
  parseComplementQuery,
  parseIntentDocument,
  parseWithdrawRequest,
  stripSignature,
  type IntentDocument,
  type SchemaPack,
  verifyDidSignature,
} from "@iep/spec";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { categoryOf, decodeCursor, encodeCursor, rateLimit } from "./util.js";

const PACKS = new Map<string, SchemaPack>([[PACK_ZERO_ID, PACK_ZERO]]);

const ensureSchema = async (db: D1Database): Promise<void> => {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY, schema_id TEXT NOT NULL, role TEXT NOT NULL, category TEXT NOT NULL, agent_did TEXT NOT NULL, principal_did TEXT NOT NULL DEFAULT '', agent_card TEXT NOT NULL, public_body TEXT NOT NULL, commit_sealed TEXT NOT NULL, commit_public TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_intents_partition ON intents (schema_id, role, category, expires_at);",
  );
  try {
    await db.exec("ALTER TABLE intents ADD COLUMN principal_did TEXT NOT NULL DEFAULT '';");
  } catch {
    // column already exists
  }
};

const jsonError = (error: unknown): Response => {
  if (error instanceof IepError) {
    return Response.json(error.toJSON(), { status: error.status });
  }
  const message = error instanceof Error ? error.message : "internal error";
  return Response.json({ error: ERROR_CODES.IEP_INVALID_DOCUMENT, message }, { status: 400 });
};

const getPack = (id: string): SchemaPack => {
  const pack = PACKS.get(id);
  if (!pack) {
    throw new IepError(ERROR_CODES.IEP_NOT_FOUND, `unknown schema pack ${id}`);
  }
  return pack;
};

const rowToDocument = (row: Record<string, unknown>): IntentDocument => {
  const principalDid = String(row["principal_did"] || row["agent_did"]);
  return parseIntentDocument({
    id: row["id"],
    iep: IEP_VERSION,
    schema: row["schema_id"],
    role: row["role"],
    principal_did: principalDid,
    agent_did: row["agent_did"],
    agent_card: row["agent_card"],
    public_body: JSON.parse(String(row["public_body"])),
    commit_sealed: row["commit_sealed"],
    commit_public: row["commit_public"],
    mandate_cid: "stored",
    discovery_providers: [],
    expires_at: row["expires_at"],
    signature: "stored",
  });
};

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/", (c) =>
  c.json({
    service: "iep-discovery",
    iep: IEP_VERSION,
    spec: "https://intentexchange.dev/protocol",
    health: "/v0/health",
  }),
);

app.get("/v0/health", (c) => c.json({ ok: true, iep: IEP_VERSION }));

app.get("/v0/schemas/:id", (c) => {
  const id = decodeURIComponent(c.req.param("id"));
  try {
    return c.json(getPack(id));
  } catch (error) {
    return jsonError(error);
  }
});

app.put("/v0/intents", async (c) => {
  try {
    await ensureSchema(c.env.DB);
    const body: unknown = await c.req.json();
    const doc = parseIntentDocument(body);
    if (!rateLimit(doc.agent_did)) {
      throw new IepError(ERROR_CODES.IEP_RATE_LIMITED, "too many writes");
    }
    assertNotExpired(doc.expires_at);
    const pack = getPack(doc.schema);
    if (doc.role !== pack.roles.alpha && doc.role !== pack.roles.beta) {
      throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "role is not in the schema pack");
    }
    assertNoSealedLeak(pack, doc.public_body);
    const expected = await commit(doc.public_body);
    if (expected !== doc.commit_public) {
      throw new IepError(ERROR_CODES.IEP_COMMIT_MISMATCH, "commit_public does not match public_body");
    }
    const ok = await verifyDidSignature(stripSignature(doc), doc.signature, doc.agent_did);
    if (!ok) {
      throw new IepError(ERROR_CODES.IEP_INVALID_SIGNATURE, "intent signature is invalid");
    }
    const category = categoryOf(doc);
    const createdAt = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO intents (
        id, schema_id, role, category, agent_did, principal_did, agent_card, public_body,
        commit_sealed, commit_public, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        schema_id = excluded.schema_id,
        role = excluded.role,
        category = excluded.category,
        agent_did = excluded.agent_did,
        principal_did = excluded.principal_did,
        agent_card = excluded.agent_card,
        public_body = excluded.public_body,
        commit_sealed = excluded.commit_sealed,
        commit_public = excluded.commit_public,
        expires_at = excluded.expires_at`,
    )
      .bind(
        doc.id,
        doc.schema,
        doc.role,
        category,
        doc.agent_did,
        doc.principal_did,
        doc.agent_card,
        JSON.stringify(doc.public_body),
        doc.commit_sealed,
        doc.commit_public,
        doc.expires_at,
        createdAt,
      )
      .run();
    return c.json({ id: doc.id, expires_at: doc.expires_at }, 201);
  } catch (error) {
    return jsonError(error);
  }
});

app.get("/v0/intents/:id", async (c) => {
  try {
    await ensureSchema(c.env.DB);
    const id = c.req.param("id");
    const row = await c.env.DB.prepare(`SELECT * FROM intents WHERE id = ?`).bind(id).first();
    if (!row) {
      throw new IepError(ERROR_CODES.IEP_NOT_FOUND, "intent not found");
    }
    return c.json({
      id: row["id"],
      schema: row["schema_id"],
      role: row["role"],
      agent_did: row["agent_did"],
      principal_did: row["principal_did"] || row["agent_did"],
      agent_card: row["agent_card"],
      public_body: JSON.parse(String(row["public_body"])),
      commit_sealed: row["commit_sealed"],
      commit_public: row["commit_public"],
      expires_at: row["expires_at"],
    });
  } catch (error) {
    return jsonError(error);
  }
});

app.delete("/v0/intents/:id", async (c) => {
  try {
    await ensureSchema(c.env.DB);
    const id = c.req.param("id");
    const body: unknown = await c.req.json();
    const request = parseWithdrawRequest(body, id);
    const row = await c.env.DB.prepare(`SELECT agent_did FROM intents WHERE id = ?`).bind(id).first<{
      agent_did: string;
    }>();
    if (!row) {
      throw new IepError(ERROR_CODES.IEP_NOT_FOUND, "intent not found");
    }
    const ok = await verifyDidSignature(
      { method: "DELETE", id, ts: request.ts },
      request.signature,
      row.agent_did,
    );
    if (!ok) {
      throw new IepError(ERROR_CODES.IEP_UNAUTHORIZED, "withdraw signature is invalid");
    }
    await c.env.DB.prepare(`DELETE FROM intents WHERE id = ?`).bind(id).run();
    return c.json({ deleted: id });
  } catch (error) {
    return jsonError(error);
  }
});

app.post("/v0/query", async (c) => {
  try {
    await ensureSchema(c.env.DB);
    const query = parseComplementQuery(await c.req.json());
    if (!rateLimit(`query:${query.schema}:${query.seeking_role}`)) {
      throw new IepError(ERROR_CODES.IEP_RATE_LIMITED, "too many queries");
    }
    const pack = getPack(query.schema);
    let self: IntentDocument;
    if (query.my_intent_id) {
      const row = await c.env.DB.prepare(`SELECT * FROM intents WHERE id = ?`)
        .bind(query.my_intent_id)
        .first();
      if (!row) {
        throw new IepError(ERROR_CODES.IEP_NOT_FOUND, "querier intent not found");
      }
      self = rowToDocument(row);
    } else if (query.public_body) {
      self = {
        id: "00000000-0000-4000-8000-000000000000",
        iep: IEP_VERSION,
        schema: query.schema,
        role: query.seeking_role === pack.roles.alpha ? pack.roles.beta : pack.roles.alpha,
        principal_did: "did:query",
        agent_did: "did:query",
        agent_card: "http://127.0.0.1/query",
        public_body: query.public_body,
        commit_sealed: "0".repeat(64),
        commit_public: "1".repeat(64),
        mandate_cid: "query",
        discovery_providers: [],
        expires_at: "2099-01-01T00:00:00.000Z",
        signature: "query",
      };
    } else {
      throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "query is missing a body");
    }
    if (self.schema !== query.schema) {
      throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "schema mismatch");
    }
    const category = categoryOf(self);
    const limit = Math.min(query.limit ?? 20, 100);
    const now = new Date().toISOString();
    let sql = `SELECT * FROM intents
      WHERE schema_id = ? AND role = ? AND category = ? AND expires_at > ?`;
    const params: string[] = [query.schema, query.seeking_role, category, now];
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      sql += ` AND (created_at > ? OR (created_at = ? AND id > ?))`;
      params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    sql += ` ORDER BY created_at ASC, id ASC LIMIT ?`;
    const rows = await c.env.DB.prepare(sql)
      .bind(...params, limit + 1)
      .all();
    const results: { id: string; public_body: IntentDocument["public_body"]; agent_card: string }[] = [];
    let next: string | null = null;
    for (const row of rows.results ?? []) {
      const candidate = rowToDocument(row as Record<string, unknown>);
      if (candidate.id === self.id) {
        continue;
      }
      if (!isComplement(pack, self, candidate)) {
        continue;
      }
      if (results.length === limit) {
        next = encodeCursor(String(row["created_at"]), candidate.id);
        break;
      }
      results.push({
        id: candidate.id,
        public_body: candidate.public_body,
        agent_card: candidate.agent_card,
      });
    }
    return c.json({ intents: results, cursor: next });
  } catch (error) {
    return jsonError(error);
  }
});

export default app;
