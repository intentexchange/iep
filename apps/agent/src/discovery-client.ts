import { ERROR_CODES, IepError, type IntentDocument, type JsonObject, type QueryHit, type QueryResult } from "@intentexchange/spec";
import { discoveryRequest } from "./http.js";

export type DiscoveryIntent = {
  agent_did: string;
  principal_did: string;
  agent_card: string;
  public_body: JsonObject;
  role: string;
};

const throwIfFailed = async (response: { ok: boolean; status: number; json: () => Promise<unknown> }, fallback: string): Promise<void> => {
  if (response.ok) {
    return;
  }
  const body = (await response.json()) as { error?: string; message?: string };
  throw new IepError(
    (body.error as typeof ERROR_CODES.IEP_INVALID_DOCUMENT) ?? ERROR_CODES.IEP_INVALID_DOCUMENT,
    body.message ?? `${fallback}: ${response.status}`,
    response.status,
  );
};

export class DiscoveryClient {
  constructor(private readonly baseUrl: string) {}

  async put(doc: IntentDocument): Promise<void> {
    const response = await discoveryRequest(`${this.baseUrl}/v0/intents`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(doc),
    });
    await throwIfFailed(response, "publish failed");
  }

  async get(id: string): Promise<DiscoveryIntent> {
    const response = await discoveryRequest(`${this.baseUrl}/v0/intents/${id}`);
    if (!response.ok) {
      throw new IepError(ERROR_CODES.IEP_NOT_FOUND, "intent not found on discovery", response.status);
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
    const response = await discoveryRequest(`${this.baseUrl}/v0/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    await throwIfFailed(response, "query failed");
    const result = (await response.json()) as QueryResult;
    return result.intents;
  }

  async delete(id: string, ts: string, signature: string): Promise<void> {
    const response = await discoveryRequest(`${this.baseUrl}/v0/intents/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ts, signature }),
    });
    await throwIfFailed(response, "withdraw failed");
  }
};
