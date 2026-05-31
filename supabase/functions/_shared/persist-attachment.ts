// Shared helpers to persist an email attachment into the `documents` table
// and the `documents` storage bucket. Used by sync-imap, sync-gmail and sync-outlook.
// deno-lint-ignore-file no-explicit-any

export type AttachmentFile = {
  filename: string;
  mimeType: string;
  data: Uint8Array;
};

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function safeFilename(name: string): string {
  return (name || "fichier").replace(/[^\w.\-]+/g, "_").slice(0, 120) || "fichier";
}

/** Decode a base64 (or base64url) string into raw bytes — for Gmail/Graph attachments. */
export function base64ToBytes(s: string, urlSafe = false): Uint8Array {
  let str = s;
  if (urlSafe) str = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (str.length % 4)) % 4;
  str = str + "=".repeat(pad);
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Persist one attachment: upload to storage and insert documents row.
 * Deduplicates on (user_id, checksum). Safe to call multiple times.
 */
export async function persistAttachment(
  admin: any,
  userId: string,
  accountId: string,
  emailId: string,
  emailSensitive: boolean,
  file: AttachmentFile,
  maxBytes = 25 * 1024 * 1024,
): Promise<{ stored: boolean; skipped?: string }> {
  try {
    if (!file.data || file.data.length === 0) return { stored: false, skipped: "empty" };
    if (file.data.length > maxBytes) {
      console.warn(`[persist-attachment] ${file.filename} skipped: ${file.data.length}B > ${maxBytes}B`);
      return { stored: false, skipped: "too_large" };
    }

    const checksum = await sha256Hex(file.data);
    const { data: existing } = await admin
      .from("documents")
      .select("id")
      .eq("user_id", userId)
      .eq("checksum", checksum)
      .maybeSingle();
    if (existing) return { stored: false, skipped: "duplicate" };

    const docId = crypto.randomUUID();
    const safe = safeFilename(file.filename);
    const path = `${userId}/email/${docId}-${safe}`;

    const { error: upErr } = await admin.storage
      .from("documents")
      .upload(path, file.data, { contentType: file.mimeType, upsert: false });
    if (upErr) { console.error(`[persist-attachment] upload failed`, upErr); return { stored: false, skipped: "upload_error" }; }

    const { error: insErr } = await admin.from("documents").insert({
      id: docId,
      user_id: userId,
      account_id: accountId,
      source_type: "email",
      source_id: emailId,
      filename: safe,
      original_filename: file.filename,
      mime_type: file.mimeType,
      file_size: file.data.length,
      storage_path: path,
      checksum,
      tags: emailSensitive ? ["email", "sensible"] : ["email"],
      is_sensitive: emailSensitive,
      sensitive_reason: emailSensitive ? "Email source classé sensible (HDS)" : null,
      local_only: false,
    });
    if (insErr) {
      console.error(`[persist-attachment] insert failed`, insErr);
      await admin.storage.from("documents").remove([path]).catch(() => {});
      return { stored: false, skipped: "insert_error" };
    }
    return { stored: true };
  } catch (e) {
    console.error(`[persist-attachment] error`, e);
    return { stored: false, skipped: "exception" };
  }
}
