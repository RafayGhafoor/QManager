// lib/config-backup/crypto.test.ts
import { describe, it, expect } from "bun:test";
import {
  deriveKey,
  encryptPayload,
  decryptPayload,
  randomBytes,
  base64Encode,
  base64Decode,
  defaultEngine,
  DecryptAuthError,
  CRYPTO_PARAMS,
  type CryptoEngine,
} from "./crypto";

const ENGINES: CryptoEngine[] = ["webcrypto", "fallback"];
const enc = (s: string) => new TextEncoder().encode(s);
// Low iteration count keeps the pure-JS cases fast; the KAT below uses the
// real 200k so the file-format parameters are pinned.
const FAST_ITER = 1000;

describe("crypto", () => {
  it("uses WebCrypto when crypto.subtle exists", () => {
    expect(defaultEngine()).toBe("webcrypto");
  });

  for (const engine of ENGINES) {
    describe(engine, () => {
      it("roundtrips a payload", async () => {
        const salt = randomBytes(CRYPTO_PARAMS.SALT_LEN);
        const iv = randomBytes(CRYPTO_PARAMS.IV_LEN);
        const key = await deriveKey("correct-horse-battery", salt, FAST_ITER, engine);
        const aad = enc('{"magic":"QMBACKUP"}');

        const ct = await encryptPayload(key, iv, enc('{"hello":"world"}'), aad);
        const pt = await decryptPayload(key, iv, ct, aad);

        expect(new TextDecoder().decode(pt)).toBe('{"hello":"world"}');
      });

      it("fails with wrong password", async () => {
        const salt = randomBytes(CRYPTO_PARAMS.SALT_LEN);
        const iv = randomBytes(CRYPTO_PARAMS.IV_LEN);
        const goodKey = await deriveKey("correct-password", salt, FAST_ITER, engine);
        const badKey = await deriveKey("wrong-password", salt, FAST_ITER, engine);
        const aad = new Uint8Array();

        const ct = await encryptPayload(goodKey, iv, enc("secret"), aad);
        await expect(decryptPayload(badKey, iv, ct, aad)).rejects.toBeInstanceOf(
          DecryptAuthError,
        );
      });

      it("fails with tampered AAD", async () => {
        const salt = randomBytes(CRYPTO_PARAMS.SALT_LEN);
        const iv = randomBytes(CRYPTO_PARAMS.IV_LEN);
        const key = await deriveKey("pw", salt, FAST_ITER, engine);

        const ct = await encryptPayload(key, iv, enc("secret"), enc("header-v1"));
        await expect(decryptPayload(key, iv, ct, enc("header-v2"))).rejects.toBeInstanceOf(
          DecryptAuthError,
        );
      });
    });
  }

  it("engines are byte-compatible in both directions", async () => {
    const salt = randomBytes(CRYPTO_PARAMS.SALT_LEN);
    const iv = randomBytes(CRYPTO_PARAMS.IV_LEN);
    const web = await deriveKey("same-passphrase", salt, FAST_ITER, "webcrypto");
    const js = await deriveKey("same-passphrase", salt, FAST_ITER, "fallback");
    const aad = enc('{"magic":"QMBACKUP","version":1}');
    const plaintext = enc('{"sections":{}}');

    const ctWeb = await encryptPayload(web, iv, plaintext, aad);
    const ctJs = await encryptPayload(js, iv, plaintext, aad);
    expect(ctJs).toEqual(ctWeb);
    expect(await decryptPayload(js, iv, ctWeb, aad)).toEqual(plaintext);
    expect(await decryptPayload(web, iv, ctJs, aad)).toEqual(plaintext);
  });

  // Known-answer vector produced outside this module (node:crypto pbkdf2Sync +
  // aes-256-gcm; the key also checked with Python hashlib) at the real file
  // parameters: PBKDF2-SHA256 200k, 16-byte salt, 12-byte IV, 16-byte tag.
  it("matches the .qmbackup known-answer vector on both engines", async () => {
    const salt = new Uint8Array([...Array(16).keys()]);
    const iv = new Uint8Array([
      0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab,
    ]);
    const aad = enc('{"magic":"QMBACKUP","version":1}');
    const plaintext = '{"sections":{"ttl_hl":{"ttl":64}}}';
    const expected = "fdlTreYAVxFosgt1u8YGvBcIBtvXjLHw4Vo+VZIeJRET8jpZlohrL14HBUsQGYnW110=";

    for (const engine of ENGINES) {
      const key = await deriveKey("correct-horse-battery", salt, CRYPTO_PARAMS.KDF_ITER, engine);
      const ct = await encryptPayload(key, iv, enc(plaintext), aad);
      expect(base64Encode(ct)).toBe(expected);
      const pt = await decryptPayload(key, iv, base64Decode(expected), aad);
      expect(new TextDecoder().decode(pt)).toBe(plaintext);
    }
  }, 20_000);

  it("base64 roundtrips binary data", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(base64Decode(base64Encode(bytes))).toEqual(bytes);
  });
});
