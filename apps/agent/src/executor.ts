import {
  A2A_PROTOCOL_VERSION,
  Role,
  TaskState,
  type Message,
  type Part,
  type Task,
} from "@a2a-js/sdk";
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { PACK_ZERO_ID } from "@iep/pack-zero";
import {
  assertWithinLimits,
  assertWithinReveal,
  authorize,
  ERROR_CODES,
  IEP_MEDIA_TYPE,
  IEP_VERSION,
  IepError,
  parseProposeBody,
  parseRatifyBody,
  parseRevealBody,
  parseVerbEnvelope,
  sessionId,
  signDocument,
  termSheetHash,
  transition,
  type JsonObject,
  type ProposeBody,
  type RatifyBody,
  type RevealBody,
  type TermSheet,
  type UnsignedVerbEnvelope,
  type VerbEnvelope,
} from "@intentexchange/spec";
import type { DiscoveryClient } from "./discovery-client.js";
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
import type { SessionEntry, SessionStore } from "./session-store.js";
import type { AgentRuntimeConfig } from "./types.js";

const dataPart = (envelope: VerbEnvelope): Part => ({
  content: { $case: "data", value: envelope },
  metadata: undefined,
  filename: "",
  mediaType: IEP_MEDIA_TYPE,
});

export const extractEnvelope = (message: Message | undefined): VerbEnvelope | null => {
  if (!message) {
    return null;
  }
  for (const part of message.parts) {
    if (part.content?.$case === "data") {
      return parseVerbEnvelope(part.content.value);
    }
  }
  return null;
};

export const extractEnvelopeFromResult = (result: Message | Task | unknown): VerbEnvelope | null => {
  if (!result || typeof result !== "object") {
    return null;
  }
  const record = result as { status?: { message?: Message }; parts?: Message["parts"]; message?: Message };
  if (record.status?.message) {
    return extractEnvelope(record.status.message);
  }
  if (record.parts) {
    return extractEnvelope(record as Message);
  }
  if (record.message) {
    return extractEnvelope(record.message);
  }
  return null;
};

export const extractFailureText = (result: unknown): string => {
  if (!result || typeof result !== "object") {
    return JSON.stringify(result);
  }
  const record = result as {
    status?: { message?: Message; state?: string };
    parts?: Message["parts"];
    message?: Message;
  };
  const message = record.status?.message ?? record.message;
  const parts = message?.parts ?? record.parts;
  if (parts) {
    for (const part of parts) {
      if (part.content?.$case === "text") {
        return part.content.value;
      }
    }
  }
  try {
    return JSON.stringify(result);
  } catch {
    return "unserializable A2A result";
  }
};

export class IepExecutor implements AgentExecutor {
  constructor(
    private readonly config: AgentRuntimeConfig,
    private readonly discovery: DiscoveryClient,
    private readonly sessions: SessionStore,
    private readonly ownIntentId: () => string,
  ) {}

  cancelTask = async (): Promise<void> => undefined;

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;
    const userMessage = requestContext.userMessage;
    const task: Task = requestContext.task ?? {
      id: taskId,
      contextId,
      status: {
        state: TaskState.TASK_STATE_SUBMITTED,
        timestamp: new Date().toISOString(),
        message: undefined,
      },
      artifacts: [],
      history: [userMessage],
      metadata: userMessage.metadata,
    };
    eventBus.publish(AgentEvent.task(task));

    try {
      const inbound = extractEnvelope(userMessage);
      if (!inbound) {
        throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "expected an IEP verb envelope");
      }
      const reply = await this.dispatch(inbound);
      const message: Message = {
        role: Role.ROLE_AGENT,
        messageId: crypto.randomUUID(),
        parts: [dataPart(reply)],
        taskId,
        contextId,
        extensions: [],
        metadata: {},
        referenceTaskIds: [],
      };
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            message,
            timestamp: new Date().toISOString(),
          },
          metadata: {},
        }),
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : "verb failed";
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_FAILED,
            timestamp: new Date().toISOString(),
            message: {
              role: Role.ROLE_AGENT,
              messageId: crypto.randomUUID(),
              parts: [
                {
                  content: { $case: "text", value: text },
                  metadata: undefined,
                  filename: "",
                  mediaType: "text/plain",
                },
              ],
              taskId,
              contextId,
              extensions: [],
              metadata: {},
              referenceTaskIds: [],
            },
          },
          metadata: {},
        }),
      );
    }
  }

  private async dispatch(inbound: VerbEnvelope): Promise<VerbEnvelope> {
    if (inbound.verb === "ping") {
      return this.handlePing(inbound);
    }
    const session = this.sessionFor(inbound);
    await verifyPeerEnvelope(inbound, session.peerAgentDid, this.ownIntentId());
    consumeNonce(session, inbound.nonce);
    session.state = transition(session.state, inbound.verb, "in");
    if (inbound.verb === "reveal") {
      return this.handleReveal(session, inbound);
    }
    if (inbound.verb === "propose") {
      return this.handlePropose(session, inbound);
    }
    if (inbound.verb === "ratify") {
      return this.handleRatify(session, inbound);
    }
    if (inbound.verb === "reject") {
      applyReject(session, inbound);
      return inbound;
    }
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, `unsupported verb ${inbound.verb}`);
  }

  private sessionFor(inbound: VerbEnvelope): SessionEntry {
    const sessionIdValue = inbound.body["session_id"];
    if (typeof sessionIdValue === "string") {
      return this.sessions.require(sessionIdValue);
    }
    throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, "session_id is required");
  }

  private async handlePing(ping: VerbEnvelope): Promise<VerbEnvelope> {
    const sender = await this.discovery.get(ping.from_intent);
    await verifyPeerEnvelope(ping, sender.agent_did, this.ownIntentId());
    authorize(this.config.mandate, "ping");
    authorize(this.config.mandate, "accept");
    const unsigned: UnsignedVerbEnvelope = {
      iep: IEP_VERSION,
      verb: "accept",
      from_intent: this.ownIntentId(),
      to_intent: ping.from_intent,
      nonce: ping.nonce,
      ts: new Date().toISOString(),
      body: {},
    };
    const accept = await signDocument<VerbEnvelope>(unsigned, this.config.keys.privateKeyPkcs8);
    const id = await sessionId(ping.nonce, accept.signature);
    this.sessions.create({
      id,
      state: "handshook",
      peerIntent: ping.from_intent,
      ownIntent: this.ownIntentId(),
      peerAgentDid: sender.agent_did,
      peerPrincipalDid: sender.principal_did,
      peerAgentCard: sender.agent_card,
      peerPublicBody: sender.public_body,
      nonces: new Set([ping.nonce]),
      round: 0,
    });
    return accept;
  }

  private async signVerb(
    session: SessionEntry,
    verb: VerbEnvelope["verb"],
    body: JsonObject,
    trackState = true,
  ): Promise<VerbEnvelope> {
    const unsigned: UnsignedVerbEnvelope = {
      iep: IEP_VERSION,
      verb,
      from_intent: this.ownIntentId(),
      to_intent: session.peerIntent,
      nonce: crypto.randomUUID(),
      ts: new Date().toISOString(),
      body,
    };
    const signed = await signDocument<VerbEnvelope>(unsigned, this.config.keys.privateKeyPkcs8);
    consumeNonce(session, signed.nonce);
    if (trackState) {
      applyOutbound(session, verb);
    }
    return signed;
  }

  private async handleReveal(session: SessionEntry, inbound: VerbEnvelope): Promise<VerbEnvelope> {
    const body = parseRevealBody(inbound.body);
    applyReveal(session, body, false);
    authorize(this.config.mandate, "reveal");
    const own: RevealBody = {
      session_id: session.id,
      stage: "ranges",
      terms: { price: this.config.mandate.reveal.price },
    };
    assertWithinReveal(this.config.mandate, own.terms);
    applyReveal(session, own, true);
    if (!session.zone) {
      authorize(this.config.mandate, "reject");
      return this.signVerb(session, "reject", asJsonObject({ session_id: session.id, reason: "no_zone" }));
    }
    return this.signVerb(session, "reveal", asJsonObject(own));
  }

  private async handlePropose(session: SessionEntry, inbound: VerbEnvelope): Promise<VerbEnvelope> {
    const body = parseProposeBody(inbound.body);
    applyPropose(session, body, this.config.role, this.config.publicBody, false);
    authorize(this.config.mandate, "propose");
    const zone = session.zone;
    if (!zone) {
      throw new IepError(ERROR_CODES.IEP_SESSION_STATE, "propose before a zone exists");
    }
    const decision = decide({
      role: this.config.role,
      zone,
      ...(session.lastMine !== undefined ? { mine: session.lastMine } : {}),
      theirs: body.term_sheet.terms.price,
      nextRound: session.round + 1,
      mandate: this.config.mandate,
    });
    if (decision.kind === "reject") {
      authorize(this.config.mandate, "reject");
      return this.signVerb(session, "reject", asJsonObject({ session_id: session.id, reason: decision.reason }));
    }
    if (decision.kind === "accept") {
      return this.signRatify(session, body.term_sheet);
    }
    const sheet = this.buildSheet(session, session.round + 1, decision.price);
    assertWithinLimits(this.config.mandate, sheet.terms);
    const propose: ProposeBody = { session_id: session.id, term_sheet: sheet };
    applyPropose(session, propose, this.config.role, this.config.publicBody, true);
    return this.signVerb(session, "propose", asJsonObject(propose));
  }

  private async handleRatify(session: SessionEntry, inbound: VerbEnvelope): Promise<VerbEnvelope> {
    const body = parseRatifyBody(inbound.body);
    await applyRatify(session, body, session.peerPrincipalDid, false);
    if (!session.ownRatification) {
      return this.signRatify(session, session.termSheet!);
    }
    await maybeSealDeal(session);
    return this.signVerb(session, "ratify", asJsonObject({
      session_id: session.id,
      term_sheet_hash: session.ownRatification.term_sheet_hash,
      principal_did: session.ownRatification.principal_did,
      ts: session.ownRatification.ts,
      principal_signature: session.ownRatification.principal_signature,
    } satisfies RatifyBody), false);
  }

  private async signRatify(session: SessionEntry, sheet: TermSheet): Promise<VerbEnvelope> {
    authorize(this.config.mandate, "ratify");
    assertWithinLimits(this.config.mandate, sheet.terms);
    session.termSheet = sheet;
    const ts = new Date().toISOString();
    const signature = await this.config.principal.ratify(sheet, ts);
    if (!signature) {
      authorize(this.config.mandate, "reject");
      return this.signVerb(session, "reject", asJsonObject({ session_id: session.id, reason: "IEP_MANDATE_DENIED" }));
    }
    const body: RatifyBody = {
      session_id: session.id,
      term_sheet_hash: await termSheetHash(sheet),
      principal_did: this.config.principal.did,
      ts,
      principal_signature: signature,
    };
    await applyRatify(session, body, this.config.principal.did, true);
    const reply = await this.signVerb(session, "ratify", asJsonObject(body));
    await maybeSealDeal(session);
    return reply;
  }

  private buildSheet(session: SessionEntry, round: number, price: number): TermSheet {
    return {
      session_id: session.id,
      schema: PACK_ZERO_ID,
      round,
      ...termIntents(this.config.role, session.ownIntent, session.peerIntent),
      terms: {
        price,
        start_at: expectedStartAt(session, this.config.publicBody),
      },
    };
  }
}

export { A2A_PROTOCOL_VERSION };
