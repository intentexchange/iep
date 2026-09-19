import type {
  AgentKeyPair,
  DealRecord,
  JsonObject,
  Mandate,
  SessionState,
  TermSheet,
  VerbName,
} from "@intentexchange/spec";

export type AgentRole = "want" | "offer";

export type PrincipalSigner = {
  did: string;
  ratify: (termSheet: TermSheet, ts: string) => Promise<string | null>;
};

export type AgentRuntimeConfig = {
  keys: AgentKeyPair;
  mandate: Mandate;
  principal: PrincipalSigner;
  role: AgentRole;
  discoveryUrl: string;
  port: number;
  host: string;
  publicUrl?: string;
  publicBody: JsonObject;
  sealedBody: JsonObject;
};

export type SessionRecord = {
  id: string;
  peerIntent: string;
  ownIntent: string;
  verb: VerbName;
  state: SessionState;
  round: number;
  deal?: DealRecord;
  rejectReason?: string;
};
