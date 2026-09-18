import {
  ERROR_CODES,
  IepError,
  type DealRecord,
  type JsonObject,
  type Range,
  type Ratification,
  type SessionState,
  type TermSheet,
} from "@intentexchange/spec";

export type SessionEntry = {
  id: string;
  state: SessionState;
  peerIntent: string;
  ownIntent: string;
  peerAgentDid: string;
  peerPrincipalDid: string;
  peerAgentCard: string;
  peerPublicBody: JsonObject;
  nonces: Set<string>;
  round: number;
  lastMine?: number;
  lastTheirs?: number;
  zone?: Range | null;
  ownReveal?: Range;
  peerReveal?: Range;
  termSheet?: TermSheet;
  ownRatification?: Ratification;
  peerRatification?: Ratification;
  deal?: DealRecord;
  rejectReason?: string;
};

export class SessionStore {
  private readonly sessions = new Map<string, SessionEntry>();

  create(entry: SessionEntry): SessionEntry {
    this.sessions.set(entry.id, entry);
    return entry;
  }

  get(id: string): SessionEntry | undefined {
    return this.sessions.get(id);
  }

  require(id: string): SessionEntry {
    const entry = this.sessions.get(id);
    if (!entry) {
      throw new IepError(ERROR_CODES.IEP_NOT_FOUND, "session not found");
    }
    return entry;
  }

  list(): SessionEntry[] {
    return [...this.sessions.values()];
  }

  deals(): DealRecord[] {
    return this.list().flatMap((entry) => (entry.deal ? [entry.deal] : []));
  }
}
