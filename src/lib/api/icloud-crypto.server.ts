import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const hex = process.env.ICLOUD_ENCRYPTION_KEY;
  if (!hex) throw new Error("ICLOUD_ENCRYPTION_KEY is not configured");
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) throw new Error("ICLOUD_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  return key;
}

export function encryptSecret(plaintext: string): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: enc.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64") };
}

export function decryptSecret(ciphertext: string, iv: string, tag: string): string {
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]);
  return dec.toString("utf8");
}
