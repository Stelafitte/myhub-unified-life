import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// Microsoft OneDrive integration via Lovable connector gateway
// ============================================================

const GATEWAY_URL = "https://connector-gateway.lovable.dev/microsoft_onedrive/v1.0";

function gatewayHeaders() {
  const lovKey = process.env.LOVABLE_API_KEY;
  const conKey = process.env.MICROSOFT_ONEDRIVE_API_KEY;
  if (!lovKey || !conKey) {
    throw new Error(
      "Connecteur Microsoft OneDrive non configuré. Lie une connexion OneDrive dans les Connecteurs.",
    );
  }
  return {
    Authorization: `Bearer ${lovKey}`,
    "X-Connection-Api-Key": conKey,
    "Content-Type": "application/json",
  };
}

interface DriveItem {
  id: string;
  name: string;
  webUrl?: string;
  size?: number;
  folder?: { childCount: number };
  file?: { mimeType: string };
  lastModifiedDateTime?: string;
  thumbnails?: Array<{ medium?: { url: string }; small?: { url: string } }>;
  parentReference?: { id?: string; path?: string };
}

// ============================================================
// List OneDrive items (root or a folder)
// ============================================================
export const listOneDriveItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        folderId: z.string().min(1).max(255).optional(),
        search: z.string().max(255).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    let url: string;
    if (data.search && data.search.trim().length > 0) {
      const q = encodeURIComponent(data.search.trim());
      url = `${GATEWAY_URL}/me/drive/root/search(q='${q}')?$top=50&$expand=thumbnails`;
    } else if (data.folderId) {
      url = `${GATEWAY_URL}/me/drive/items/${encodeURIComponent(data.folderId)}/children?$top=100&$expand=thumbnails`;
    } else {
      url = `${GATEWAY_URL}/me/drive/root/children?$top=100&$expand=thumbnails`;
    }

    const res = await fetch(url, { headers: gatewayHeaders() });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OneDrive (${res.status}): ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { value?: DriveItem[] };
    const items = (json.value ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      webUrl: i.webUrl ?? null,
      isFolder: !!i.folder,
      mimeType: i.file?.mimeType ?? null,
      size: i.size ?? null,
      modifiedAt: i.lastModifiedDateTime ?? null,
      thumbnail: i.thumbnails?.[0]?.medium?.url ?? i.thumbnails?.[0]?.small?.url ?? null,
    }));
    return { items };
  });

// ============================================================
// Link an Office 365 file as a collab document
// ============================================================
export const linkOffice365Document = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        spaceId: z.string().uuid(),
        itemId: z.string().min(1).max(255),
        name: z.string().min(1).max(500),
        webUrl: z.string().url(),
        thumbnailUrl: z.string().url().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: doc, error } = await supabase
      .from("collab_documents")
      .insert({
        user_id: userId,
        space_id: data.spaceId,
        title: data.name,
        doc_type: "office",
        collab_mode: "realtime",
        content: { type: "doc", content: [{ type: "paragraph" }] },
        office_provider: "onedrive",
        office_item_id: data.itemId,
        office_url: data.webUrl,
        office_thumbnail_url: data.thumbnailUrl ?? null,
        office_synced_at: new Date().toISOString(),
        last_edited_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { document: doc };
  });

// ============================================================
// Refresh Office 365 metadata for a linked doc
// ============================================================
export const refreshOffice365Document = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ documentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: doc, error: e1 } = await supabase
      .from("collab_documents")
      .select("office_item_id, office_provider")
      .eq("id", data.documentId)
      .single();
    if (e1) throw new Error(e1.message);
    if (doc.office_provider !== "onedrive" || !doc.office_item_id) {
      throw new Error("Ce document n'est pas lié à OneDrive.");
    }
    const res = await fetch(
      `${GATEWAY_URL}/me/drive/items/${encodeURIComponent(doc.office_item_id)}?$expand=thumbnails`,
      { headers: gatewayHeaders() },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OneDrive (${res.status}): ${body.slice(0, 200)}`);
    }
    const item = (await res.json()) as DriveItem;
    const thumb =
      item.thumbnails?.[0]?.medium?.url ?? item.thumbnails?.[0]?.small?.url ?? null;
    const { error: e2 } = await supabase
      .from("collab_documents")
      .update({
        title: item.name,
        office_url: item.webUrl ?? null,
        office_thumbnail_url: thumb,
        office_synced_at: new Date().toISOString(),
      })
      .eq("id", data.documentId);
    if (e2) throw new Error(e2.message);
    return {
      title: item.name,
      webUrl: item.webUrl ?? null,
      thumbnailUrl: thumb,
      modifiedAt: item.lastModifiedDateTime ?? null,
    };
  });
