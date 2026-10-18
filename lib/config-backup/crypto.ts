// lib/config-backup/crypto.ts
//
// AES-256-GCM + PBKDF2-SHA256 for .qmbackup files. WebCrypto when the page
// has it; @noble (pure JS) otherwise, because `crypto.subtle` only exists in
// a secure context and the UI is normally reached over plain http:// on the
// LAN (ledger B5.33). Both engines produce byte-identical output: same KDF,
// same cipher, 16-byte tag appended to the ciphertext.

import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

const PBKDF2_ITER = 200_000;
const KEY_BYTES = 32;

export type CryptoEngine = "webcrypto" | "fallback";

/** Opaque derived key; which engine made it decides how it is used. */
export type BackupKey =
  | { engine: "webcrypto"; key: CryptoKey }
  | { engine: "fallback"; bytes: Uint8Array };

/** Thrown by decryptPayload when the tag does not verify: a wrong
 *  passphrase or a tampered file. Anything else is a different fault. */
export class DecryptAuthError extends Error {
  constructor() {
    super("decrypt_failed");
    this.name = "DecryptAuthError";
  }
}

export function defaultEngine(): CryptoEngine {
  return typeof globalThis.crypto?.subtle?.importKey === "function"
    ? "webcrypto"
    : "fallback";
}

function toFixedBuffer(u: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)) as Uint8Array<ArrayBuffer>;
}

export function randomBytes(len: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(len);
  // getRandomValues is available in insecure contexts too.
  crypto.getRandomValues(buf);
  return buf;
}

export function base64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function base64Decode(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Derive a 256-bit AES-GCM key from a passphrase + salt via PBKDF2-SHA256. */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iter: number = PBKDF2_ITER,
  engine: CryptoEngine = defaultEngine(),
): Promise<BackupKey> {
  const pass = new TextEncoder().encode(passphrase);
  if (engine === "fallback") {
    // Async variant yields to the event loop so the tab stays responsive.
    const bytes = await pbkdf2Async(sha256, pass, salt, { c: iter, dkLen: KEY_BYTES });
    return { engine, bytes };
  }
  const passKey = await crypto.subtle.importKey("raw", pass, { name: "PBKDF2" }, false, [
    "deriveKey",
  ]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", iterations: iter, salt: toFixedBuffer(salt) },
    passKey,
    { name: "AES-GCM", length: KEY_BYTES * 8 },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );
  return { engine, key };
}

/** Encrypt plaintext → ciphertext (includes 16-byte GCM tag appended). */
export async function encryptPayload(
  key: BackupKey,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  if (key.engine === "fallback") {
    return toFixedBuffer(gcm(key.bytes, iv, aad).encrypt(plaintext));
  }
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toFixedBuffer(iv), additionalData: toFixedBuffer(aad), tagLength: 128 },
    key.key,
    toFixedBuffer(plaintext),
  );
  return new Uint8Array(ct);
}

/** Decrypt ciphertext (with appended tag) → plaintext. Throws
 *  DecryptAuthError when the tag does not verify. */
export async function decryptPayload(
  key: BackupKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    if (key.engine === "fallback") {
      return toFixedBuffer(gcm(key.bytes, iv, aad).decrypt(ciphertext));
    }
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toFixedBuffer(iv), additionalData: toFixedBuffer(aad), tagLength: 128 },
      key.key,
      toFixedBuffer(ciphertext),
    );
    return new Uint8Array(pt);
  } catch {
    throw new DecryptAuthError();
  }
}

export const CRYPTO_PARAMS = {
  KDF_ITER: PBKDF2_ITER,
  SALT_LEN: 16,
  IV_LEN: 12,
  KEY_BITS: KEY_BYTES * 8,
} as const;
