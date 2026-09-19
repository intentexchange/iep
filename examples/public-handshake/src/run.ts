import { spawn, type ChildProcess } from "node:child_process";
import { autoSigner, discoveryRequest, startAgent, useRecursiveDns, type StartedAgent } from "@iep/agent";
import { OFFER_1, OFFER_MANDATE, WANT_1, WANT_MANDATE } from "@iep/pack-zero";
import {
  generateKeyPair,
  REFERENCE_DISCOVERY_URL,
  signDocument,
  verifyRatification,
  type Mandate,
  type UnsignedMandate,
} from "@intentexchange/spec";

const WANT_PORT = 41251;
const OFFER_PORT = 41252;

const usage = `yarn public-handshake
Completes ping → accept → reveal → propose → ratify against the hosted Discovery.

Requires two reachable HTTPS agent cards:
  IEP_WANT_PUBLIC_URL and IEP_OFFER_PUBLIC_URL
or cloudflared on PATH (quick tunnels).
`;

const waitFor = async (url: string, timeoutMs = 45_000): Promise<void> => {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await discoveryRequest(url);
      if (response.ok) {
        return;
      }
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`timeout waiting for ${url}: ${last}`);
};

const signSideMandate = async (
  body: Omit<UnsignedMandate, "principal_did" | "agent_did" | "expires_at">,
  principal: Awaited<ReturnType<typeof generateKeyPair>>,
  agentDid: string,
  expiresAt: string,
): Promise<Mandate> => {
  const unsigned: UnsignedMandate = {
    ...body,
    principal_did: principal.did,
    agent_did: agentDid,
    expires_at: expiresAt,
  };
  return signDocument<Mandate>(unsigned, principal.privateKeyPkcs8);
};

const originOf = (value: string): string => {
  return value.replace(/\/$/u, "");
};

const hasCloudflared = async (): Promise<boolean> => {
  return new Promise((resolve) => {
    const child = spawn("cloudflared", ["--version"], { stdio: "ignore" });
    child.on("error", () => {
      resolve(false);
    });
    child.on("exit", (code) => {
      resolve(code === 0);
    });
  });
};

const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/u;

const startTunnel = (port: number): { process: ChildProcess; url: Promise<string> } => {
  const child = spawn("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${port}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`timed out waiting for cloudflared URL on port ${port}`));
    }, 45_000);
    const succeed = (found: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(found);
    };
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const handleChunk = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      process.stderr.write(text);
      const match = TUNNEL_URL.exec(text);
      if (match?.[0]) {
        succeed(match[0]);
      }
    };
    child.stdout?.on("data", handleChunk);
    child.stderr?.on("data", handleChunk);
    child.on("error", (error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });
    child.on("exit", (code) => {
      fail(new Error(`cloudflared exited ${code} before publishing a URL`));
    });
  });
  return { process: child, url };
};

const stopTunnel = (child: ChildProcess | undefined): void => {
  if (!child || child.killed) {
    return;
  }
  child.kill("SIGTERM");
};

const publicOrigins = async (): Promise<{
  want: string;
  offer: string;
  tunnels: ChildProcess[];
}> => {
  const wantEnv = process.env["IEP_WANT_PUBLIC_URL"];
  const offerEnv = process.env["IEP_OFFER_PUBLIC_URL"];
  if (wantEnv && offerEnv) {
    return { want: originOf(wantEnv), offer: originOf(offerEnv), tunnels: [] };
  }
  if (await hasCloudflared()) {
    const wantTunnel = startTunnel(WANT_PORT);
    const offerTunnel = startTunnel(OFFER_PORT);
    try {
      const [want, offer] = await Promise.all([wantTunnel.url, offerTunnel.url]);
      return { want, offer, tunnels: [wantTunnel.process, offerTunnel.process] };
    } catch (error) {
      stopTunnel(wantTunnel.process);
      stopTunnel(offerTunnel.process);
      throw error;
    }
  }
  process.stderr.write(usage);
  process.stderr.write(
    `Bind want on http://127.0.0.1:${WANT_PORT} and offer on http://127.0.0.1:${OFFER_PORT}.\n` +
      `Set IEP_WANT_PUBLIC_URL and IEP_OFFER_PUBLIC_URL to reachable HTTPS origins, or install cloudflared.\n`,
  );
  process.exitCode = 2;
  throw new Error("no public agent card URLs");
};

const main = async (): Promise<void> => {
  if (process.argv.slice(2).includes("--help")) {
    process.stdout.write(usage);
    return;
  }

  useRecursiveDns();

  const baseUrl = (process.env["IEP_DISCOVERY_URL"] ?? REFERENCE_DISCOVERY_URL).replace(/\/$/u, "");
  await waitFor(`${baseUrl}/v0/health`);
  const health = (await (await discoveryRequest(`${baseUrl}/v0/health`)).json()) as { iep?: string };
  process.stdout.write(`DISCOVERY ${baseUrl} iep=${health.iep ?? "?"}\n`);

  const origins = await publicOrigins();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const category = `widget-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const wantPublic = {
    ...WANT_1.public_body,
    category,
    summary: `public-handshake want ${category}`,
  };
  const offerPublic = {
    ...OFFER_1.public_body,
    category,
    summary: `public-handshake offer ${category}`,
  };

  const wantPrincipal = await generateKeyPair();
  const offerPrincipal = await generateKeyPair();
  const wantKeys = await generateKeyPair();
  const offerKeys = await generateKeyPair();
  const wantMandate = await signSideMandate(WANT_MANDATE, wantPrincipal, wantKeys.did, expiresAt);
  const offerMandate = await signSideMandate(OFFER_MANDATE, offerPrincipal, offerKeys.did, expiresAt);

  let want: StartedAgent | undefined;
  let offer: StartedAgent | undefined;
  try {
    offer = await startAgent({
      keys: offerKeys,
      mandate: offerMandate,
      principal: autoSigner(offerPrincipal),
      role: "offer",
      discoveryUrl: baseUrl,
      port: OFFER_PORT,
      host: "127.0.0.1",
      publicUrl: origins.offer,
      publicBody: offerPublic,
      sealedBody: { reserve: 50 },
    });
    want = await startAgent({
      keys: wantKeys,
      mandate: wantMandate,
      principal: autoSigner(wantPrincipal),
      role: "want",
      discoveryUrl: baseUrl,
      port: WANT_PORT,
      host: "127.0.0.1",
      publicUrl: origins.want,
      publicBody: wantPublic,
      sealedBody: { reserve: 40 },
    });

    process.stdout.write(`WANT_CARD ${want.agentCardUrl}\n`);
    process.stdout.write(`OFFER_CARD ${offer.agentCardUrl}\n`);
    await waitFor(`http://127.0.0.1:${WANT_PORT}/iep/health`);
    await waitFor(`http://127.0.0.1:${OFFER_PORT}/iep/health`);
    await waitFor(`${origins.want}/iep/health`, 90_000);
    await waitFor(`${origins.offer}/iep/health`, 90_000);

    await offer.publish();
    await want.publish();
    const sessions = await want.hunt();
    const offerSessions = offer.getSessions();
    if (sessions.length === 0 || offerSessions.length === 0) {
      throw new Error("handshake produced no session");
    }
    if (sessions[0]!.id !== offerSessions[0]!.id) {
      throw new Error(`session mismatch ${sessions[0]!.id} vs ${offerSessions[0]!.id}`);
    }
    process.stdout.write(`SESSION ${sessions[0]!.id}\n`);

    const negotiated = await want.negotiate(sessions[0]!.id);
    const wantDeal = negotiated.deal ?? want.getDeals()[0];
    const offerDeal = offer.getDeals()[0];
    if (!wantDeal || !offerDeal) {
      throw new Error("negotiation produced no deal");
    }
    if (wantDeal.deal_id !== offerDeal.deal_id) {
      throw new Error(`deal mismatch ${wantDeal.deal_id} vs ${offerDeal.deal_id}`);
    }
    const principals = new Set(wantDeal.ratifications.map((item) => item.principal_did));
    if (!principals.has(wantPrincipal.did) || !principals.has(offerPrincipal.did)) {
      throw new Error("deal is missing a principal ratification");
    }
    for (const ratification of wantDeal.ratifications) {
      if (!(await verifyRatification(ratification))) {
        throw new Error(`invalid ratification from ${ratification.principal_did}`);
      }
    }
    process.stdout.write(
      `DEAL ${wantDeal.deal_id} price=${wantDeal.term_sheet.terms.price} rounds=${wantDeal.term_sheet.round}\n`,
    );

    const wantId = want.intentId;
    const offerId = offer.intentId;
    await want.withdraw();
    await offer.withdraw();
    const wantGone = await discoveryRequest(`${baseUrl}/v0/intents/${wantId}`);
    const offerGone = await discoveryRequest(`${baseUrl}/v0/intents/${offerId}`);
    if (wantGone.status !== 404 || offerGone.status !== 404) {
      throw new Error(
        `withdraw did not delete intents want=${wantGone.status} offer=${offerGone.status}`,
      );
    }
    process.stdout.write("WITHDRAWN\n");
  } finally {
    await want?.stop().catch(() => undefined);
    await offer?.stop().catch(() => undefined);
    for (const tunnel of origins.tunnels) {
      stopTunnel(tunnel);
    }
  }
};

main().catch((error: unknown) => {
  if (process.exitCode === 2) {
    return;
  }
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
