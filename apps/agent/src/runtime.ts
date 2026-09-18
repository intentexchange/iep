import {
  A2A_PROTOCOL_VERSION,
  AGENT_CARD_PATH,
  Role,
  type AgentCard,
  type Message,
} from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import { PACK_ZERO, PACK_ZERO_ID } from "@iep/pack-zero";
import {
  assertWithinLimits,
  assertWithinReveal,
  authorize,
  commit,
  ERROR_CODES,
  IEP_EXTENSION_URI,
  IEP_MEDIA_TYPE,
  IEP_VERSION,
  IepError,
  mandateCid,
  parseProposeBody,
  parseRatifyBody,
  parseRevealBody,
  sessionId,
  signDocument,
  termSheetHash,
  transition,
  verifyMandate,
  type DealRecord,
  type IntentDocument,
  type JsonObject,
  type ProposeBody,
  type RatifyBody,
  type RevealBody,
  type TermSheet,
  type UnsignedIntentDocument,
  type UnsignedVerbEnvelope,
  type VerbEnvelope,
} from "@intentexchange/spec";
import express from "express";
import { DiscoveryClient } from "./discovery-client.js";
import { extractEnvelopeFromResult, extractFailureText, IepExecutor } from "./executor.js";
import { decide } from "./negotiate.js";
import {
  applyOutbound,
  applyPropose,
  applyRatify,
  applyReject,
  applyReveal,
  asJsonObject,
  consumeNonce,
  expectedStartAt,
  maybeSealDeal,
  termIntents,
  verifyPeerEnvelope,
} from "./protocol.js";
import type { SessionEntry } from "./session-store.js";
import { SessionStore } from "./session-store.js";
import type { AgentRuntimeConfig, SessionRecord } from "./types.js";

export type StartedAgent = {
  intentId: string;
  agentCardUrl: string;
  getSessions: () => SessionRecord[];
  getDeals: () => DealRecord[];
  publish: () => Promise<IntentDocument>;
  hunt: () => Promise<SessionRecord[]>;
  negotiate: (sessionId: string) => Promise<SessionRecord>;
  stop: () => Promise<void>;
};

const seekingRole = (role: "want" | "offer"): "want" | "offer" => {
  return role === "want" ? "offer" : "want";
};

const verbFor = (entry: SessionEntry): SessionRecord["verb"] => {
  if (entry.rejectReason) {
    return "reject";
  }
  if (entry.deal || entry.state === "ratifying" || entry.state === "ratified") {
    return "ratify";
  }
  if (entry.state === "bargaining") {
    return "propose";
  }
  if (entry.state === "revealed") {
    return "reveal";
  }
  return "accept";
};

const toRecord = (entry: SessionEntry): SessionRecord => {
  const record: SessionRecord = {
    id: entry.id,
    peerIntent: entry.peerIntent,
    ownIntent: entry.ownIntent,
    verb: verbFor(entry),
    state: entry.state,
    round: entry.round,
  };
  if (entry.deal) {
    record.deal = entry.deal;
  }
  if (entry.rejectReason) {
    record.rejectReason = entry.rejectReason;
  }
  return record;
};

export const startAgent = async (config: AgentRuntimeConfig): Promise<StartedAgent> => {
  await verifyMandate(config.mandate, config.keys.did);
  const discovery = new DiscoveryClient(config.discoveryUrl);
  const sessions = new SessionStore();
  let published: IntentDocument | undefined;
  const ownIntentId = (): string => {
    if (!published) {
      throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "agent has not published an intent");
    }
    return published.id;
  };

  const agentCardUrl = `http://${config.host}:${config.port}/${AGENT_CARD_PATH}`;
  const jsonRpcUrl = `http://${config.host}:${config.port}/`;

  const card: AgentCard = {
    name: `IEP ${config.role} agent`,
    description: "Reference Intent Exchange Protocol fiduciary agent.",
    supportedInterfaces: [
      {
        url: jsonRpcUrl,
        protocolBinding: "JSONRPC",
        tenant: "",
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    provider: {
      organization: "IEP",
      url: "https://intentexchange.dev",
    },
    version: "0.2.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [
        {
          uri: IEP_EXTENSION_URI,
          description: "Intent Exchange Protocol session verbs",
          required: false,
          params: { iep: IEP_VERSION },
        },
      ],
      extendedAgentCard: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json", "task-status"],
    skills: [
      {
        id: "intent-exchange",
        name: "Intent Exchange",
        description: "Publish, query, ping, reveal, propose, and ratify complementary intents.",
        tags: ["iep", "intent"],
        examples: [],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        securityRequirements: [],
      },
    ],
    documentationUrl: "https://intentexchange.dev",
    signatures: [],
  };

  const executor = new IepExecutor(config, discovery, sessions, ownIntentId);
  const requestHandler = new DefaultRequestHandler(card, new InMemoryTaskStore(), executor);
  const app = express();
  app.get("/iep/health", (_req, res) => {
    res.json({ ok: true, role: config.role, sessions: sessions.list().length });
  });
  app.get("/iep/sessions", (_req, res) => {
    res.json({ sessions: sessions.list().map(toRecord) });
  });
  app.get("/iep/deals", (_req, res) => {
    res.json({ deals: sessions.deals() });
  });
  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use(jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const started = app.listen(config.port, config.host, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(started);
    });
  });

  const sendVerb = async (
    peerCard: string,
    envelope: VerbEnvelope,
    contextId: string,
  ): Promise<VerbEnvelope> => {
    const factory = new ClientFactory();
    const client = await factory.createFromUrl(peerCard.replace(/\/\.well-known\/agent-card\.json$/u, ""));
    const message: Message = {
      role: Role.ROLE_USER,
      messageId: crypto.randomUUID(),
      parts: [
        {
          content: { $case: "data", value: envelope },
          metadata: undefined,
          filename: "",
          mediaType: IEP_MEDIA_TYPE,
        },
      ],
      contextId,
      taskId: "",
      metadata: {},
      extensions: [],
      referenceTaskIds: [],
    };
    const result = await client.sendMessage(
      {
        tenant: "",
        message,
        configuration: undefined,
        metadata: undefined,
      },
      { serviceParameters: { "A2A-Extensions": IEP_EXTENSION_URI } },
    );
    const reply = extractEnvelopeFromResult(result);
    if (!reply) {
      throw new IepError(
        ERROR_CODES.IEP_INVALID_DOCUMENT,
        `peer did not return an IEP envelope: ${extractFailureText(result)}`,
      );
    }
    return reply;
  };

  const signVerb = async (
    session: SessionEntry,
    verb: VerbEnvelope["verb"],
    body: JsonObject,
    trackState = true,
  ): Promise<VerbEnvelope> => {
    const unsigned: UnsignedVerbEnvelope = {
      iep: IEP_VERSION,
      verb,
      from_intent: ownIntentId(),
      to_intent: session.peerIntent,
      nonce: crypto.randomUUID(),
      ts: new Date().toISOString(),
      body,
    };
    const signed = await signDocument<VerbEnvelope>(unsigned, config.keys.privateKeyPkcs8);
    consumeNonce(session, signed.nonce);
    if (trackState) {
      applyOutbound(session, verb);
    }
    return signed;
  };

  const ingest = async (session: SessionEntry, inbound: VerbEnvelope, trackState = true): Promise<void> => {
    await verifyPeerEnvelope(inbound, session.peerAgentDid, ownIntentId());
    consumeNonce(session, inbound.nonce);
    if (trackState) {
      session.state = transition(session.state, inbound.verb, "in");
    }
    if (inbound.verb === "reveal") {
      applyReveal(session, parseRevealBody(inbound.body), false);
      return;
    }
    if (inbound.verb === "propose") {
      applyPropose(session, parseProposeBody(inbound.body), config.role, config.publicBody, false);
      return;
    }
    if (inbound.verb === "ratify") {
      await applyRatify(session, parseRatifyBody(inbound.body), session.peerPrincipalDid, false);
      await maybeSealDeal(session);
      return;
    }
    if (inbound.verb === "reject") {
      applyReject(session, inbound);
    }
  };

  const buildSheet = (session: SessionEntry, round: number, price: number): TermSheet => ({
    session_id: session.id,
    schema: PACK_ZERO_ID,
    round,
    ...termIntents(config.role, session.ownIntent, session.peerIntent),
    terms: {
      price,
      start_at: expectedStartAt(session, config.publicBody),
    },
  });

  const sendOwnRatify = async (session: SessionEntry, sheet: TermSheet, trackState = true): Promise<void> => {
    authorize(config.mandate, "ratify");
    assertWithinLimits(config.mandate, sheet.terms);
    session.termSheet = sheet;
    if (!session.ownRatification) {
      const ts = new Date().toISOString();
      const signature = await config.principal.ratify(sheet, ts);
      if (!signature) {
        throw new IepError(ERROR_CODES.IEP_MANDATE_DENIED, "principal refused to ratify");
      }
      const body: RatifyBody = {
        session_id: session.id,
        term_sheet_hash: await termSheetHash(sheet),
        principal_did: config.principal.did,
        ts,
        principal_signature: signature,
      };
      await applyRatify(session, body, config.principal.did, true);
      const outbound = await signVerb(session, "ratify", asJsonObject(body), trackState);
      const reply = await sendVerb(session.peerAgentCard, outbound, session.id);
      await ingest(session, reply, session.state !== "ratified");
      await maybeSealDeal(session);
      return;
    }
    const body: RatifyBody = {
      session_id: session.id,
      term_sheet_hash: session.ownRatification.term_sheet_hash,
      principal_did: session.ownRatification.principal_did,
      ts: session.ownRatification.ts,
      principal_signature: session.ownRatification.principal_signature,
    };
    const outbound = await signVerb(session, "ratify", asJsonObject(body), trackState);
    const reply = await sendVerb(session.peerAgentCard, outbound, session.id);
    await ingest(session, reply, false);
    await maybeSealDeal(session);
  };

  const publish = async (): Promise<IntentDocument> => {
    authorize(config.mandate, "publish");
    for (const key of PACK_ZERO.sealed_fields) {
      if (Object.hasOwn(config.publicBody, key)) {
        throw new IepError(ERROR_CODES.IEP_SEALED_LEAK, "sealed field on public body");
      }
    }
    const unsigned: UnsignedIntentDocument = {
      id: crypto.randomUUID(),
      iep: IEP_VERSION,
      schema: PACK_ZERO_ID,
      role: config.role,
      principal_did: config.mandate.principal_did,
      agent_did: config.keys.did,
      agent_card: agentCardUrl,
      public_body: config.publicBody,
      commit_sealed: await commit(config.sealedBody),
      commit_public: await commit(config.publicBody),
      mandate_cid: await mandateCid(config.mandate),
      discovery_providers: [config.discoveryUrl],
      expires_at: config.mandate.expires_at,
    };
    const doc = await signDocument<IntentDocument>(unsigned, config.keys.privateKeyPkcs8);
    await discovery.put(doc);
    published = doc;
    return doc;
  };

  const hunt = async (): Promise<SessionRecord[]> => {
    authorize(config.mandate, "query");
    authorize(config.mandate, "ping");
    if (!published) {
      await publish();
    }
    const hits = await discovery.query({
      schema: PACK_ZERO_ID,
      seeking_role: seekingRole(config.role),
      my_intent_id: ownIntentId(),
    });
    const ranked = [...hits].sort((a, b) => {
      const left = JSON.stringify(a.public_body);
      const right = JSON.stringify(b.public_body);
      return left.localeCompare(right);
    });
    const cap = Math.min(config.mandate.ping_cap, ranked.length);
    const created: SessionRecord[] = [];
    for (const hit of ranked.slice(0, cap)) {
      try {
        const pingUnsigned: UnsignedVerbEnvelope = {
          iep: IEP_VERSION,
          verb: "ping",
          from_intent: ownIntentId(),
          to_intent: hit.id,
          nonce: crypto.randomUUID(),
          ts: new Date().toISOString(),
          body: {},
        };
        const ping = await signDocument<VerbEnvelope>(pingUnsigned, config.keys.privateKeyPkcs8);
        const accept = await sendVerb(hit.agent_card, ping, "");
        if (accept.verb !== "accept") {
          continue;
        }
        const peer = await discovery.get(accept.from_intent);
        await verifyPeerEnvelope(accept, peer.agent_did, ownIntentId());
        if (accept.nonce !== ping.nonce) {
          continue;
        }
        const id = await sessionId(ping.nonce, accept.signature);
        const entry = sessions.create({
          id,
          state: "handshook",
          peerIntent: hit.id,
          ownIntent: ownIntentId(),
          peerAgentDid: peer.agent_did,
          peerPrincipalDid: peer.principal_did,
          peerAgentCard: hit.agent_card,
          peerPublicBody: hit.public_body,
          nonces: new Set([ping.nonce, accept.nonce]),
          round: 0,
        });
        created.push(toRecord(entry));
      } catch {
        continue;
      }
    }
    return created;
  };

  const negotiate = async (id: string): Promise<SessionRecord> => {
    const session = sessions.require(id);
    authorize(config.mandate, "reveal");
    const ownReveal: RevealBody = {
      session_id: session.id,
      stage: "ranges",
      terms: { price: config.mandate.reveal.price },
    };
    assertWithinReveal(config.mandate, ownReveal.terms);
    applyReveal(session, ownReveal, true);
    const revealOut = await signVerb(session, "reveal", asJsonObject(ownReveal));
    const revealReply = await sendVerb(session.peerAgentCard, revealOut, session.id);
    await ingest(session, revealReply);
    if (revealReply.verb === "reject") {
      return toRecord(session);
    }
    if (!session.zone) {
      authorize(config.mandate, "reject");
      session.rejectReason = "no_zone";
      const rejectOut = await signVerb(session, "reject", asJsonObject({ session_id: session.id, reason: "no_zone" }));
      await sendVerb(session.peerAgentCard, rejectOut, session.id);
      return toRecord(session);
    }

    authorize(config.mandate, "propose");
    for (;;) {
      if (!session.zone) {
        throw new IepError(ERROR_CODES.IEP_SESSION_STATE, "zone missing during bargaining");
      }
      const decision = decide({
        role: config.role,
        zone: session.zone,
        ...(session.lastMine !== undefined ? { mine: session.lastMine } : {}),
        ...(session.lastTheirs !== undefined ? { theirs: session.lastTheirs } : {}),
        nextRound: session.round + 1,
        mandate: config.mandate,
      });
      if (decision.kind === "reject") {
        authorize(config.mandate, "reject");
        const rejectOut = await signVerb(
          session,
          "reject",
          asJsonObject({ session_id: session.id, reason: decision.reason }),
        );
        await sendVerb(session.peerAgentCard, rejectOut, session.id);
        session.rejectReason = decision.reason;
        return toRecord(session);
      }
      if (decision.kind === "accept") {
        if (!session.termSheet) {
          throw new IepError(ERROR_CODES.IEP_SESSION_STATE, "accept without a peer term sheet");
        }
        await sendOwnRatify(session, session.termSheet);
        return toRecord(session);
      }
      const sheet = buildSheet(session, session.round + 1, decision.price);
      assertWithinLimits(config.mandate, sheet.terms);
      const propose: ProposeBody = { session_id: session.id, term_sheet: sheet };
      applyPropose(session, propose, config.role, config.publicBody, true);
      const proposeOut = await signVerb(session, "propose", asJsonObject(propose));
      const proposeReply = await sendVerb(session.peerAgentCard, proposeOut, session.id);
      await ingest(session, proposeReply);
      if (proposeReply.verb === "reject") {
        return toRecord(session);
      }
      if (proposeReply.verb === "ratify") {
        await sendOwnRatify(session, session.termSheet ?? sheet, session.state !== "ratified");
        return toRecord(session);
      }
    }
  };

  const stop = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };

  return {
    intentId: "",
    agentCardUrl,
    getSessions: () => sessions.list().map(toRecord),
    getDeals: () => sessions.deals(),
    publish,
    hunt,
    negotiate,
    stop,
  };
};
