import { resolve4 } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { OFFER_1, PACK_ZERO_ID, WANT_1 } from "@iep/pack-zero";
import {
  commit,
  generateKeyPair,
  mandateCid,
  REFERENCE_DISCOVERY_URL,
  signCanonical,
  signDocument,
  type IntentDocument,
  type Mandate,
  type UnsignedIntentDocument,
  type UnsignedMandate,
} from "@intentexchange/spec";

const usage = `yarn public-index [--role want|offer] [--withdraw]
Talks to the hosted reference Discovery. A2A handshake still needs a reachable agent_card.
`;

type DiscoveryResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

const discoveryRequest = async (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<DiscoveryResponse> => {
  const parsed = new URL(url);
  let connectHost = parsed.hostname;
  try {
    const ips = await resolve4(parsed.hostname);
    const first = ips[0];
    if (first) {
      connectHost = first;
    }
  } catch {
    // fall back to the hostname if recursive DNS fails
  }
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: "https:",
        hostname: connectHost,
        servername: parsed.hostname,
        port: Number(parsed.port || 443),
        path: `${parsed.pathname}${parsed.search}`,
        method: init.method ?? "GET",
        headers: {
          Host: parsed.hostname,
          ...(init.headers ?? {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 500;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => JSON.parse(text) as unknown,
          });
        });
      },
    );
    req.on("error", reject);
    if (init.body) {
      req.write(init.body);
    }
    req.end();
  });
};

const flagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write(usage);
    return;
  }
  const role = (flagValue(args, "--role") ?? process.env["IEP_ROLE"] ?? "want") as "want" | "offer";
  if (role !== "want" && role !== "offer") {
    process.stderr.write(usage);
    process.exitCode = 1;
    return;
  }
  const baseUrl = (process.env["IEP_DISCOVERY_URL"] ?? REFERENCE_DISCOVERY_URL).replace(/\/$/, "");
  const healthResponse = await discoveryRequest(`${baseUrl}/v0/health`);
  if (!healthResponse.ok) {
    throw new Error(`discovery health failed: ${healthResponse.status}`);
  }
  const health = (await healthResponse.json()) as { iep?: string };
  process.stdout.write(`DISCOVERY ${baseUrl} iep=${health.iep ?? "?"}\n`);

  const keys = await generateKeyPair();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const unsignedMandate: UnsignedMandate = {
    principal_did: keys.did,
    agent_did: keys.did,
    grants: ["publish", "query"],
    ping_cap: 1,
    expires_at: expiresAt,
    reveal: { price: { min: 30, max: 80 } },
    limits: { price: {} },
  };
  const mandate = await signDocument<Mandate>(unsignedMandate, keys.privateKeyPkcs8);
  const fixture = role === "want" ? WANT_1 : OFFER_1;
  const unsigned: UnsignedIntentDocument = {
    id: crypto.randomUUID(),
    iep: fixture.iep,
    schema: PACK_ZERO_ID,
    role,
    principal_did: keys.did,
    agent_did: keys.did,
    agent_card: "https://intentexchange.dev",
    public_body: fixture.public_body,
    commit_sealed: await commit({ reserve: role === "want" ? 40 : 50 }),
    commit_public: await commit(fixture.public_body),
    mandate_cid: await mandateCid(mandate),
    discovery_providers: [baseUrl],
    expires_at: expiresAt,
  };
  const doc = await signDocument<IntentDocument>(unsigned, keys.privateKeyPkcs8);
  const put = await discoveryRequest(`${baseUrl}/v0/intents`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!put.ok) {
    const body = (await put.json()) as { message?: string };
    throw new Error(body.message ?? `publish failed: ${put.status}`);
  }
  process.stdout.write(`PUBLISHED ${doc.id} role=${role} expires=${expiresAt}\n`);

  const seeking = role === "want" ? "offer" : "want";
  const query = await discoveryRequest(`${baseUrl}/v0/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schema: PACK_ZERO_ID,
      seeking_role: seeking,
      my_intent_id: doc.id,
    }),
  });
  if (!query.ok) {
    const body = (await query.json()) as { message?: string };
    throw new Error(body.message ?? `query failed: ${query.status}`);
  }
  const result = (await query.json()) as { intents: { id: string; agent_card: string }[] };
  process.stdout.write(`HITS ${result.intents.length} seeking=${seeking}\n`);
  for (const hit of result.intents) {
    process.stdout.write(`  ${hit.id}  ${hit.agent_card}\n`);
  }
  if (result.intents.length === 0) {
    process.stdout.write(`(no complement yet — run with --role ${seeking})\n`);
  }

  if (!args.includes("--withdraw")) {
    return;
  }
  const ts = new Date().toISOString();
  const signature = await signCanonical({ method: "DELETE", id: doc.id, ts }, keys.privateKeyPkcs8);
  const del = await discoveryRequest(`${baseUrl}/v0/intents/${doc.id}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ts, signature }),
  });
  if (!del.ok) {
    throw new Error(`withdraw failed: ${del.status}`);
  }
  process.stdout.write(`WITHDRAWN ${doc.id}\n`);
};

main().catch((error: unknown) => {
  const detail =
    error instanceof Error && error.cause instanceof Error
      ? `${error.message}: ${error.cause.message}`
      : error instanceof Error
        ? error.message
        : String(error);
  process.stderr.write(`${detail}\n`);
  process.exitCode = 1;
});
