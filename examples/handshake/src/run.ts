import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { autoSigner, startAgent } from "@iep/agent";
import {
  OFFER_1,
  OFFER_2,
  OFFER_MANDATE,
  OFFER_MANDATE_NO_ZONE,
  WANT_1,
  WANT_2,
  WANT_MANDATE,
  WANT_MANDATE_NO_ZONE,
} from "@iep/pack-zero";
import {
  generateKeyPair,
  signDocument,
  verifyRatification,
  type Mandate,
  type UnsignedMandate,
} from "@iep/spec";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const waitFor = async (url: string, timeoutMs = 30_000): Promise<void> => {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      last = await response.text();
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`timeout waiting for ${url}: ${last}`);
};

const signSideMandate = async (
  body: Omit<UnsignedMandate, "principal_did" | "agent_did">,
  principal: Awaited<ReturnType<typeof generateKeyPair>>,
  agentDid: string,
): Promise<Mandate> => {
  const unsigned: UnsignedMandate = {
    ...body,
    principal_did: principal.did,
    agent_did: agentDid,
  };
  return signDocument<Mandate>(unsigned, principal.privateKeyPkcs8);
};

const main = async (): Promise<void> => {
  await rm(resolve(repoRoot, "apps/discovery/.wrangler/state"), { recursive: true, force: true });
  const discovery: ChildProcess = spawn("yarn", ["workspace", "@iep/discovery", "dev"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  discovery.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  discovery.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));

  const stopDiscovery = (): void => {
    discovery.kill("SIGTERM");
  };

  try {
    await waitFor("http://127.0.0.1:8787/v0/health");

    const wantPrincipal = await generateKeyPair();
    const offerPrincipal = await generateKeyPair();
    const wantKeys = await generateKeyPair();
    const offerKeys = await generateKeyPair();
    const wantMandate = await signSideMandate(WANT_MANDATE, wantPrincipal, wantKeys.did);
    const offerMandate = await signSideMandate(OFFER_MANDATE, offerPrincipal, offerKeys.did);

    const offer = await startAgent({
      keys: offerKeys,
      mandate: offerMandate,
      principal: autoSigner(offerPrincipal),
      role: "offer",
      discoveryUrl: "http://127.0.0.1:8787",
      port: 41242,
      host: "127.0.0.1",
      publicBody: OFFER_1.public_body,
      sealedBody: { reserve: 50 },
    });
    const want = await startAgent({
      keys: wantKeys,
      mandate: wantMandate,
      principal: autoSigner(wantPrincipal),
      role: "want",
      discoveryUrl: "http://127.0.0.1:8787",
      port: 41241,
      host: "127.0.0.1",
      publicBody: WANT_1.public_body,
      sealedBody: { reserve: 40 },
    });

    try {
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
      if (wantDeal.term_sheet.round > 8) {
        throw new Error(`deal exceeded max rounds: ${wantDeal.term_sheet.round}`);
      }
      const price = wantDeal.term_sheet.terms.price;
      if (price > 60 || price < 40) {
        throw new Error(`price ${price} is outside both limits`);
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
        `DEAL ${wantDeal.deal_id} price=${price} rounds=${wantDeal.term_sheet.round}\n`,
      );
    } finally {
      await want.stop();
      await offer.stop();
    }

    const noZoneWantPrincipal = await generateKeyPair();
    const noZoneOfferPrincipal = await generateKeyPair();
    const noZoneWantKeys = await generateKeyPair();
    const noZoneOfferKeys = await generateKeyPair();
    const noZoneWantMandate = await signSideMandate(
      WANT_MANDATE_NO_ZONE,
      noZoneWantPrincipal,
      noZoneWantKeys.did,
    );
    const noZoneOfferMandate = await signSideMandate(
      OFFER_MANDATE_NO_ZONE,
      noZoneOfferPrincipal,
      noZoneOfferKeys.did,
    );
    const noZoneOffer = await startAgent({
      keys: noZoneOfferKeys,
      mandate: noZoneOfferMandate,
      principal: autoSigner(noZoneOfferPrincipal),
      role: "offer",
      discoveryUrl: "http://127.0.0.1:8787",
      port: 41244,
      host: "127.0.0.1",
      publicBody: OFFER_2.public_body,
      sealedBody: { reserve: 50 },
    });
    const noZoneWant = await startAgent({
      keys: noZoneWantKeys,
      mandate: noZoneWantMandate,
      principal: autoSigner(noZoneWantPrincipal),
      role: "want",
      discoveryUrl: "http://127.0.0.1:8787",
      port: 41243,
      host: "127.0.0.1",
      publicBody: WANT_2.public_body,
      sealedBody: { reserve: 40 },
    });
    try {
      await noZoneOffer.publish();
      await noZoneWant.publish();
      const sessions = await noZoneWant.hunt();
      if (sessions.length === 0) {
        throw new Error("no-zone handshake produced no session");
      }
      const rejected = await noZoneWant.negotiate(sessions[0]!.id);
      if (rejected.rejectReason !== "no_zone") {
        throw new Error(`expected no_zone, got ${rejected.rejectReason ?? rejected.state}`);
      }
      const offerRejected = noZoneOffer.getSessions()[0];
      if (offerRejected?.rejectReason !== "no_zone" && offerRejected?.state !== "rejected") {
        throw new Error("offer agent did not record no_zone reject");
      }
      process.stdout.write(`REJECTED no_zone\n`);
    } finally {
      await noZoneWant.stop();
      await noZoneOffer.stop();
    }

    process.stdout.write("handshake ok\n");
  } finally {
    stopDiscovery();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
