import { base58btcDecode, base58btcEncode } from "./encoding.js";

const ED25519_PREFIX = new Uint8Array([0xed, 0x01]);

export const publicKeyToDidKey = (publicKey: Uint8Array): string => {
  if (publicKey.length !== 32) {
    throw new Error("Ed25519 public key must be 32 bytes");
  }
  const prefixed = new Uint8Array(34);
  prefixed.set(ED25519_PREFIX, 0);
  prefixed.set(publicKey, 2);
  return `did:key:z${base58btcEncode(prefixed)}`;
};

export const didKeyToPublicKey = (did: string): Uint8Array => {
  if (!did.startsWith("did:key:z")) {
    throw new Error("only did:key Ed25519 identifiers are supported");
  }
  const decoded = base58btcDecode(did.slice("did:key:z".length));
  if (decoded.length < 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error("did:key is not an Ed25519 public key");
  }
  return decoded.slice(2, 34);
};
