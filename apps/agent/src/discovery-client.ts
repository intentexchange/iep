import { ERROR_CODES, IepError, type JsonObject, type QueryHit, type QueryResult } from "@intentexchange/spec";

export type DiscoveryIntent = {
  agent_did: string;
  principal_did: string;
  agent_card: string;
  public_body: JsonObject;
  role: string;
};

export class DiscoveryClient {
  constructor(private readonly baseUrl: string) {}

  async put(doc: import("@intentexchange/spec").IntentDocument): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v0/intents`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(doc),
    });
    if (!response.ok) {
      const body = (await response.json()) as { error?: string; message?: string };
      throw new IepError(
        (body.error as typeof ERROR_CODES.IEP_INVALID_DOCUMENT) ?? ERROR_CODES.IEP_INVALID_DOCUMENT,
        body.message ?? `publish failed: ${response.status}`,
        response.status,
      );
    }
  }

  async get(id: string): Promise<DiscoveryIntent> {
    const response = await fetch(`${this.baseUrl}/v0/intents/${id}`);
    if (!response.ok) {
      throw new IepError(ERROR_CODES.IEP_NOT_FOUND, "intent not found on discovery");
    }
    const row = (await response.json()) as {
      agent_did: string;
      principal_did?: string;
      agent_card: string;
      public_body: JsonObject;
      role: string;
    };
    return {
      agent_did: row.agent_did,
      principal_did: row.principal_did ?? row.agent_did,
      agent_card: row.agent_card,
      public_body: row.public_body,
      role: row.role,
    };
  }

  async query(input: {
    schema: string;
    seeking_role: string;
    my_intent_id: string;
  }): Promise<QueryHit[]> {
    const response = await fetch(`${this.baseUrl}/v0/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      throw new IepError(ERROR_CODES.IEP_INVALID_DOCUMENT, body.message ?? "query failed");
    }
    const result = (await response.json()) as QueryResult;
    return result.intents;
  }
}
