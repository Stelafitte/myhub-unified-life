import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/microsoft_onedrive";

export type OneDriveFolder = {
  id: string;
  name: string;
  /** Full path from root, e.g. "Travail/SFC/Réunions" */
  path: string;
  /** Depth from root (0 = top-level folder). */
  depth: number;
  childCount: number;
};

type GraphItem = {
  id: string;
  name: string;
  folder?: { childCount?: number };
};

/**
 * List folders in OneDrive Personal, recursively up to MAX_DEPTH.
 * Used as the primary source of "themes" for smart email grouping.
 */
export const listOneDriveFolders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const connKey = process.env.MICROSOFT_ONEDRIVE_API_KEY;
    if (!lovableKey) throw new Error("LOVABLE_API_KEY manquant");
    if (!connKey) throw new Error("MICROSOFT_ONEDRIVE_API_KEY manquant — connectez OneDrive.");

    const headers = {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connKey,
    };

    const MAX_DEPTH = 3;
    const MAX_TOTAL = 500;
    const folders: OneDriveFolder[] = [];

    async function listChildren(itemId: string | "root"): Promise<GraphItem[]> {
      const url =
        itemId === "root"
          ? `${GATEWAY_URL}/me/drive/root/children?$top=200`
          : `${GATEWAY_URL}/me/drive/items/${itemId}/children?$top=200`;
      const r = await fetch(url, { headers });
      if (!r.ok) {
        // Don't crash the page — just log and return empty so the inbox keeps working.
        console.warn(`OneDrive ${itemId} ${r.status}: ${await r.text().catch(() => "")}`);
        return [];
      }
      const j = (await r.json()) as { value?: GraphItem[] };
      return (j.value ?? []).filter((it) => it.folder);
    }

    async function walk(parentId: string | "root", parentPath: string, depth: number) {
      if (folders.length >= MAX_TOTAL) return;
      const children = await listChildren(parentId);
      // Cap fan-out per parent to keep latency reasonable.
      const slice = children.slice(0, depth === 0 ? 100 : 30);
      const subs: { id: string; path: string }[] = [];
      for (const f of slice) {
        if (folders.length >= MAX_TOTAL) break;
        const path = parentPath ? `${parentPath}/${f.name}` : f.name;
        folders.push({
          id: f.id,
          name: f.name,
          path,
          depth,
          childCount: f.folder?.childCount ?? 0,
        });
        if (depth + 1 < MAX_DEPTH && (f.folder?.childCount ?? 0) > 0) {
          subs.push({ id: f.id, path });
        }
      }
      await Promise.all(subs.map((s) => walk(s.id, s.path, depth + 1)));
    }

    await walk("root", "", 0);

    return { folders };
  });
