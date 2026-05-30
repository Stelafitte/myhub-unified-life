import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/microsoft_onedrive/v1.0";

export type OneDriveFolder = {
  id: string;
  name: string;
  path: string;
  childCount: number;
};

type GraphItem = {
  id: string;
  name: string;
  folder?: { childCount?: number };
  parentReference?: { path?: string };
};

/**
 * List folders in OneDrive Personal: root + 1 level deep.
 * Returns a flat list usable as smart-grouping themes.
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

    const folders: OneDriveFolder[] = [];

    // Root folders
    const rootRes = await fetch(`${GATEWAY_URL}/me/drive/root/children?$top=100`, { headers });
    if (!rootRes.ok) {
      throw new Error(`OneDrive root ${rootRes.status}: ${await rootRes.text()}`);
    }
    const rootJson = (await rootRes.json()) as { value?: GraphItem[] };
    const rootFolders = (rootJson.value ?? []).filter((it) => it.folder);

    for (const f of rootFolders) {
      folders.push({
        id: f.id,
        name: f.name,
        path: f.name,
        childCount: f.folder?.childCount ?? 0,
      });
    }

    // One level deep, only for folders that have children
    await Promise.all(
      rootFolders
        .filter((f) => (f.folder?.childCount ?? 0) > 0)
        .slice(0, 20) // safety cap
        .map(async (parent) => {
          try {
            const r = await fetch(
              `${GATEWAY_URL}/me/drive/items/${parent.id}/children?$top=50`,
              { headers },
            );
            if (!r.ok) return;
            const j = (await r.json()) as { value?: GraphItem[] };
            for (const it of j.value ?? []) {
              if (!it.folder) continue;
              folders.push({
                id: it.id,
                name: it.name,
                path: `${parent.name}/${it.name}`,
                childCount: it.folder?.childCount ?? 0,
              });
            }
          } catch {
            /* ignore one folder failure */
          }
        }),
    );

    return { folders };
  });
