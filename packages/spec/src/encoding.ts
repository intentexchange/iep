const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const base58btcEncode = (bytes: Uint8Array): string => {
  if (bytes.length === 0) {
    return "";
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros += 1;
  }
  const size = Math.ceil(((bytes.length - zeros) * Math.log(256)) / Math.log(58)) + 1;
  const encoded = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i]!;
    let j = 0;
    for (let k = encoded.length - 1; (carry !== 0 || j < length) && k >= 0; k -= 1, j += 1) {
      carry += 256 * encoded[k]!;
      encoded[k] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = j;
  }
  let start = encoded.length - length;
  while (start < encoded.length && encoded[start] === 0) {
    start += 1;
  }
  let out = "1".repeat(zeros);
  for (let i = start; i < encoded.length; i += 1) {
    out += ALPHABET[encoded[i]!]!;
  }
  return out;
};

export const base58btcDecode = (input: string): Uint8Array => {
  let zeros = 0;
  while (zeros < input.length && input[zeros] === "1") {
    zeros += 1;
  }
  const size = Math.ceil((input.length * Math.log(58)) / Math.log(256)) + 1;
  const decoded = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < input.length; i += 1) {
    const ch = input[i]!;
    const value = ALPHABET.indexOf(ch);
    if (value < 0) {
      throw new Error(`invalid base58 character: ${ch}`);
    }
    let carry = value;
    let j = 0;
    for (let k = decoded.length - 1; (carry !== 0 || j < length) && k >= 0; k -= 1, j += 1) {
      carry += 58 * decoded[k]!;
      decoded[k] = carry % 256;
      carry = Math.floor(carry / 256);
    }
    length = j;
  }
  let start = decoded.length - length;
  while (start < decoded.length && decoded[start] === 0) {
    start += 1;
  }
  const out = new Uint8Array(zeros + (decoded.length - start));
  out.set(decoded.slice(start), zeros);
  return out;
};

export const bytesToBase64Url = (bytes: Uint8Array): string => {
  let bin = "";
  for (const byte of bytes) {
    bin += String.fromCharCode(byte);
  }
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

export const base64UrlToBytes = (input: string): Uint8Array => {
  const padded = input.replaceAll("-", "+").replaceAll("_", "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
};

export const bytesToHex = (bytes: Uint8Array): string => {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const asBufferSource = (bytes: Uint8Array): ArrayBuffer => {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};
