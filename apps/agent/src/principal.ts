import {
  ratificationPayload,
  signRatification,
  termSheetHash,
  type AgentKeyPair,
  type TermSheet,
} from "@iep/spec";
import type { PrincipalSigner } from "./types.js";

export const autoSigner = (keys: AgentKeyPair): PrincipalSigner => ({
  did: keys.did,
  ratify: async (termSheet: TermSheet, ts: string): Promise<string | null> => {
    const hash = await termSheetHash(termSheet);
    const signed = await signRatification(
      ratificationPayload(termSheet.session_id, hash, keys.did, ts),
      keys.privateKeyPkcs8,
    );
    return signed.principal_signature;
  },
});

export const denySigner = (did: string): PrincipalSigner => ({
  did,
  ratify: async (): Promise<string | null> => null,
});
