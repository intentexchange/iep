#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  authorize,
  generateKeyPair,
  parseKeyPair,
  parseMandate,
  serializeKeyPair,
  signDocument,
  type JsonObject,
  type Mandate,
  type UnsignedMandate,
} from "@intentexchange/spec";
import { autoSigner, denySigner } from "./principal.js";
import { startAgent } from "./runtime.js";
import type { AgentRole } from "./types.js";

const usage = `iep-agent keygen --out <file>
iep-agent sign-mandate --principal <keys> --mandate <json> [--out <file>]
iep-agent --config <dir> <serve|publish|hunt|negotiate>
`;

const loadJson = async (path: string): Promise<unknown> => {
  return JSON.parse(await readFile(path, "utf8"));
};

const flagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
};

const keygen = async (args: string[]): Promise<void> => {
  const out = flagValue(args, "--out");
  if (!out) {
    process.stderr.write(usage);
    process.exitCode = 1;
    return;
  }
  const keys = await generateKeyPair();
  await writeFile(resolve(out), serializeKeyPair(keys), "utf8");
  process.stdout.write(`${keys.did}\n`);
};

const signMandateCli = async (args: string[]): Promise<void> => {
  const principalPath = flagValue(args, "--principal");
  const mandatePath = flagValue(args, "--mandate");
  if (!principalPath || !mandatePath) {
    process.stderr.write(usage);
    process.exitCode = 1;
    return;
  }
  const principal = parseKeyPair(await readFile(resolve(principalPath), "utf8"));
  const raw = (await loadJson(resolve(mandatePath))) as UnsignedMandate & { signature?: string };
  const unsigned: UnsignedMandate = {
    ...raw,
    principal_did: principal.did,
  };
  const signed = await signDocument<Mandate>(unsigned, principal.privateKeyPkcs8);
  const out = flagValue(args, "--out") ?? mandatePath;
  await writeFile(resolve(out), `${JSON.stringify(signed, null, 2)}\n`, "utf8");
  process.stdout.write(`${signed.signature}\n`);
};

const runConfigured = async (args: string[]): Promise<void> => {
  const configIndex = args.indexOf("--config");
  if (configIndex < 0 || !args[configIndex + 1] || args.length < 3) {
    process.stderr.write(usage);
    process.exitCode = 1;
    return;
  }
  const dir = resolve(args[configIndex + 1]!);
  const command = args.filter((arg) => arg !== "--config" && arg !== args[configIndex + 1]).at(-1);
  const agentJson = (await loadJson(resolve(dir, "agent.json"))) as {
    role: AgentRole;
    discovery_url: string;
    port: number;
    host?: string;
    principal?: "auto" | "deny";
  };
  const mandate = parseMandate(await loadJson(resolve(dir, "mandate.json")));
  const intent = (await loadJson(resolve(dir, "intent.json"))) as {
    public: JsonObject;
    sealed: JsonObject;
  };
  const keys = parseKeyPair(await readFile(resolve(dir, "keys.json"), "utf8"));
  const principal =
    agentJson.principal === "deny"
      ? denySigner(mandate.principal_did)
      : autoSigner(parseKeyPair(await readFile(resolve(dir, "principal-keys.json"), "utf8")));
  const runtime = await startAgent({
    keys,
    mandate,
    principal,
    role: agentJson.role,
    discoveryUrl: agentJson.discovery_url,
    port: agentJson.port,
    host: agentJson.host ?? "127.0.0.1",
    publicBody: intent.public,
    sealedBody: intent.sealed,
  });

  if (command === "serve") {
    process.stdout.write(`serving on ${runtime.agentCardUrl}\n`);
    return;
  }
  if (command === "publish") {
    authorize(mandate, "publish");
    const doc = await runtime.publish();
    process.stdout.write(`${doc.id}\n`);
    await runtime.stop();
    return;
  }
  if (command === "hunt") {
    const sessionList = await runtime.hunt();
    for (const session of sessionList) {
      process.stdout.write(`SESSION ${session.id}\n`);
    }
    await runtime.stop();
    return;
  }
  if (command === "negotiate") {
    const sessionList = await runtime.hunt();
    const first = sessionList[0];
    if (!first) {
      throw new Error("hunt produced no session");
    }
    const negotiated = await runtime.negotiate(first.id);
    process.stdout.write(`SESSION ${negotiated.id}\n`);
    if (negotiated.deal) {
      process.stdout.write(
        `DEAL ${negotiated.deal.deal_id} price=${negotiated.deal.term_sheet.terms.price} rounds=${negotiated.deal.term_sheet.round}\n`,
      );
    } else if (negotiated.rejectReason) {
      process.stdout.write(`REJECTED ${negotiated.rejectReason}\n`);
    }
    await runtime.stop();
    return;
  }
  process.stderr.write(usage);
  await runtime.stop();
  process.exitCode = 1;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === "keygen") {
    await keygen(args);
    return;
  }
  if (command === "sign-mandate") {
    await signMandateCli(args);
    return;
  }
  await runConfigured(args);
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
