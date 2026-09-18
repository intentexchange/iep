import { canonicalize, stripSignature } from "./canonicalize.js";
import { didKeyToPublicKey, publicKeyToDidKey } from "./did.js";
import { base64UrlToBytes, bytesToBase64Url, bytesToHex, asBufferSource } from "./encoding.js";
import { IEP_VERSION, type Mandate, type Ratification, type RatificationPayload, type TermSheet } from "./types.js";

export type AgentKeyPair = {
  did: string;
  publicKey: Uint8Array;
  privateKeyPkcs8: Uint8Array;
};

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const digest = await crypto.subtle.digest("SHA-256", asBufferSource(bytes));
  return new Uint8Array(digest);
};

export const commit = async (value: unknown): Promise<string> => {
  const encoded = new TextEncoder().encode(canonicalize(value));
  return bytesToHex(await sha256(encoded));
};

export const sessionId = async (pingNonce: string, acceptSignature: string): Promise<string> => {
  const encoded = new TextEncoder().encode(`${pingNonce}${acceptSignature}`);
  return bytesToHex(await sha256(encoded));
};

export const mandateCid = async (mandate: Mandate): Promise<string> => {
  return commit(mandate);
};

export const termSheetHash = async (termSheet: TermSheet): Promise<string> => {
  return commit(termSheet);
};

export const dealId = async (session: string, hash: string): Promise<string> => {
  const encoded = new TextEncoder().encode(`${session}${hash}`);
  return bytesToHex(await sha256(encoded));
};

export const ratificationPayload = (
  session: string,
  hash: string,
  principalDid: string,
  ts: string,
): RatificationPayload => ({
  iep: IEP_VERSION,
  session_id: session,
  term_sheet_hash: hash,
  principal_did: principalDid,
  ts,
});

export const signRatification = async (
  payload: RatificationPayload,
  privateKeyPkcs8: Uint8Array,
): Promise<Ratification> => {
  const principal_signature = await signCanonical(payload, privateKeyPkcs8);
  return { ...payload, principal_signature };
};

export const verifyRatification = async (ratification: Ratification): Promise<boolean> => {
  const { principal_signature, ...payload } = ratification;
  return verifyDidSignature(payload, principal_signature, ratification.principal_did);
};

export const generateKeyPair = async (): Promise<AgentKeyPair> => {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const privateKeyPkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    did: publicKeyToDidKey(publicKey),
    publicKey,
    privateKeyPkcs8,
  };
};

const importPrivateKey = async (pkcs8: Uint8Array): Promise<CryptoKey> => {
  return crypto.subtle.importKey("pkcs8", asBufferSource(pkcs8), "Ed25519", false, ["sign"]);
};

const importPublicKey = async (raw: Uint8Array): Promise<CryptoKey> => {
  return crypto.subtle.importKey("raw", asBufferSource(raw), "Ed25519", false, ["verify"]);
};

export const signCanonical = async (
  payload: unknown,
  privateKeyPkcs8: Uint8Array,
): Promise<string> => {
  const key = await importPrivateKey(privateKeyPkcs8);
  const data = new TextEncoder().encode(canonicalize(payload));
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", key, asBufferSource(data)));
  return bytesToBase64Url(signature);
};

export const verifyCanonical = async (
  payload: unknown,
  signature: string,
  publicKey: Uint8Array,
): Promise<boolean> => {
  const key = await importPublicKey(publicKey);
  const data = new TextEncoder().encode(canonicalize(payload));
  return crypto.subtle.verify("Ed25519", key, asBufferSource(base64UrlToBytes(signature)), asBufferSource(data));
};

export const verifyDidSignature = async (
  payload: unknown,
  signature: string,
  did: string,
): Promise<boolean> => {
  return verifyCanonical(payload, signature, didKeyToPublicKey(did));
};

export const signDocument = async <T extends { signature: string }>(
  unsigned: Omit<T, "signature">,
  privateKeyPkcs8: Uint8Array,
): Promise<T> => {
  const { signature: _ignored, ...rest } = unsigned as T & { signature?: string };
  const signature = await signCanonical(rest, privateKeyPkcs8);
  return { ...rest, signature } as T;
};

export const verifySignedDocument = async <T extends { signature: string; agent_did?: string }>(
  signed: T,
  did = signed.agent_did,
): Promise<boolean> => {
  if (!did) {
    return false;
  }
  return verifyDidSignature(stripSignature(signed), signed.signature, did);
};

export const serializeKeyPair = (keys: AgentKeyPair): string => {
  return JSON.stringify({
    did: keys.did,
    publicKey: bytesToBase64Url(keys.publicKey),
    privateKeyPkcs8: bytesToBase64Url(keys.privateKeyPkcs8),
  });
};

export const parseKeyPair = (raw: string): AgentKeyPair => {
  const parsed = JSON.parse(raw) as {
    did: string;
    publicKey: string;
    privateKeyPkcs8: string;
  };
  return {
    did: parsed.did,
    publicKey: base64UrlToBytes(parsed.publicKey),
    privateKeyPkcs8: base64UrlToBytes(parsed.privateKeyPkcs8),
  };
};
