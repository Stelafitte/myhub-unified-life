import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/microsoft_onedrive";
const SIMPLE_PUT_LIMIT = 4 * 1024 * 1024; // 4 MB — OneDrive simple PUT cap
const CHUNK = 5 * 1024 * 1024; // 5 MB per chunk for upload session

const Input = z.object({
  storagePath: z.string().min(1).max(512),
  folderId: z.string().min(1).max(256),
  filename: z.string().min(1).max(255),
  documentId: z.string().uuid().optional(),
  folderPath: z.string().min(1).max(500).optional(),
});


function safeName(name: string): string {
  // OneDrive forbids: " * : < > ? / \ |
  return name.replace(/[\"*:<>?/\\|]+/g, "_").slice(0, 250);
}

/**
 * Upload a Supabase Storage file into a specific OneDrive folder.
 * Uses simple PUT for small files and upload sessions for larger ones.
 */
export const uploadFileToOneDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const connKey = process.env.MICROSOFT_ONEDRIVE_API_KEY;
    if (!lovableKey) throw new Error("LOVABLE_API_KEY manquant");
    if (!connKey) throw new Error("OneDrive non connecté — ajoute le connecteur Microsoft OneDrive.");

    // 1. Download from Supabase storage (server-side, bypasses RLS)
    const dl = await supabaseAdmin.storage.from("documents").download(data.storagePath);
    if (dl.error || !dl.data) throw new Error(dl.error?.message ?? "Fichier introuvable");
    const blob = dl.data;
    const filename = safeName(data.filename);

    const baseHeaders = {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connKey,
    };

    let result: { id: string; name: string; webUrl?: string } | null = null;

    // 2a. Simple upload (small files)
    if (blob.size <= SIMPLE_PUT_LIMIT) {
      const url = `${GATEWAY_URL}/me/drive/items/${encodeURIComponent(data.folderId)}:/${encodeURIComponent(filename)}:/content`;
      const r = await fetch(url, {
        method: "PUT",
        headers: { ...baseHeaders, "Content-Type": blob.type || "application/octet-stream" },
        body: await blob.arrayBuffer(),
      });
      if (!r.ok) throw new Error(`OneDrive upload ${r.status}: ${await r.text().catch(() => "")}`);
      result = (await r.json()) as { id: string; name: string; webUrl?: string };
    } else {
      // 2b. Upload session (large files)
      const sessUrl = `${GATEWAY_URL}/me/drive/items/${encodeURIComponent(data.folderId)}:/${encodeURIComponent(filename)}:/createUploadSession`;
      const sessR = await fetch(sessUrl, {
        method: "POST",
        headers: { ...baseHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename", name: filename } }),
      });
      if (!sessR.ok) throw new Error(`OneDrive session ${sessR.status}: ${await sessR.text().catch(() => "")}`);
      const { uploadUrl } = (await sessR.json()) as { uploadUrl: string };

      const buf = new Uint8Array(await blob.arrayBuffer());
      const total = buf.byteLength;
      let offset = 0;
      while (offset < total) {
        const end = Math.min(offset + CHUNK, total);
        const slice = buf.subarray(offset, end);
        const r = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Length": String(slice.byteLength),
            "Content-Range": `bytes ${offset}-${end - 1}/${total}`,
          },
          body: slice,
        });
        if (r.status !== 202 && !r.ok) {
          throw new Error(`OneDrive chunk ${r.status}: ${await r.text().catch(() => "")}`);
        }
        if (r.ok && r.status !== 202) result = (await r.json()) as typeof result;
        offset = end;
      }
      if (!result) throw new Error("Upload OneDrive incomplet");
    }

    // 3. Mark the document row as saved (if a documentId was provided)
    if (data.documentId && result) {
      const { error: upErr } = await supabaseAdmin
        .from("documents")
        .update({
          onedrive_item_id: result.id,
          onedrive_web_url: result.webUrl ?? null,
          onedrive_folder_path: data.folderPath ?? null,
          saved_at: new Date().toISOString(),
        })
        .eq("id", data.documentId);
      if (upErr) console.warn("Failed to mark document saved:", upErr.message);
    }

    return result;
  });

