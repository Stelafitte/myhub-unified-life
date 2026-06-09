// Server-only encryption helper for user-supplied AI provider API keys.
// Uses AES-256-GCM. Requires AI_KEYS_ENCRYPTION_KEY in env.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.AI_KEYS_ENCRYPTION_KEY;
  if (!raw) throw new Error("AI_KEYS_ENCRYPTION_KEY is not configured");
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw, "utf8").digest();
}

export function isAiEncryptionAvailable(): boolean {
  return !!process.env.AI_KEYS_ENCRYPTION_KEY;
}

/** Encrypts and returns a single base64 bundle "iv.ct.tag" suitable for one DB column. */
export function encryptAiKey(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${enc.toString("base64")}.${tag.toString("base64")}`;
}

export function decryptAiKey(bundle: string): string {
  const parts = bundle.split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted AI key format");
  const [ivB64, ctB64, tagB64] = parts;
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
