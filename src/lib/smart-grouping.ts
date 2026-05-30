// Smart auto-grouping of emails by theme — driven primarily by the user's
// OneDrive folder structure (folders + subfolders). A small built-in
// ruleset is kept only as a fallback when no OneDrive theme matches.

import type { CachedEmail } from "@/lib/inbox-cache";

export type SmartGroup = {
  key: string;
  label: string;
  icon: string; // emoji
  /** Returns true if this email belongs to the group. */
  match: (e: CachedEmail, ctx: { hay: string; from: string; domain: string }) => boolean;
};

export type FolderInput = {
  name: string;
  path: string;
  depth?: number;
};

// ---------------------------------------------------------------------------
// Fallback built-in rules (only applied if no folder theme matches)
// ---------------------------------------------------------------------------

const COMMERCIAL_KEYWORDS = [
  "newsletter", "unsubscribe", "se désabonner", "désinscription",
  "promo", "promotion", "soldes", "offre", "réduction", "code promo",
  "marketing", "campagne", "nouveauté", "exclusif", "black friday",
];

const IT_PROVIDER_DOMAINS = [
  "ovh.com", "ovh.net", "ovhcloud.com",
  "microsoft.com", "office.com", "office365.com", "outlook.com", "azure.com", "microsoftonline.com",
  "google.com", "googlemail.com", "googleapis.com", "googlecloud.com",
  "github.com", "gitlab.com", "bitbucket.org",
  "vercel.com", "netlify.com", "cloudflare.com",
  "aws.amazon.com", "amazonaws.com",
  "scaleway.com", "gandi.net", "ionos.fr", "ionos.com",
  "adobe.com", "dropbox.com", "slack.com", "zoom.us", "atlassian.com",
  "notion.so", "supabase.com", "supabase.io",
  "openai.com", "anthropic.com",
  "lovable.dev", "lovable.app",
  "stripe.com", "paypal.com",
];

const FALLBACK_GROUPS: SmartGroup[] = [
  {
    key: "prestataires",
    label: "Prestataires IT",
    icon: "🛠️",
    match: (_e, { domain }) =>
      IT_PROVIDER_DOMAINS.some((d) => domain === d || domain.endsWith("." + d)),
  },
  {
    key: "commerciales",
    label: "Infos commerciales",
    icon: "🛒",
    match: (e, { hay }) =>
      e.ai_category === "newsletter" || COMMERCIAL_KEYWORDS.some((k) => hay.includes(k)),
  },
];

export const SMART_GROUPS: SmartGroup[] = FALLBACK_GROUPS;

// ---------------------------------------------------------------------------
// OneDrive folder → theme conversion
// ---------------------------------------------------------------------------

/** Generic folder names that don't carry a real theme. */
const FOLDER_STOP = new Set([
  "documents", "document", "perso", "personnel", "personal", "divers",
  "archive", "archives", "backup", "tmp", "temp", "old", "images", "photos",
  "vidéos", "videos", "musique", "music", "downloads", "téléchargements",
  "desktop", "bureau", "shared", "partagé", "partages", "attachments",
  "pièces jointes", "pieces jointes", "mes documents", "my documents",
  "divers", "autre", "autres", "misc",
]);

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}+/gu, "")
    .split(/[\\/\s_\-–—.,()[\]]+/)
    .filter((t) => t.length >= 3 && !FOLDER_STOP.has(t));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function depthIcon(depth: number): string {
  if (depth === 0) return "📁";
  if (depth === 1) return "📂";
  return "🗂️";
}

/**
 * Build smart groups from a OneDrive folder tree.
 * Each folder (root or subfolder) becomes one theme. A top-level folder
 * also matches emails containing any of its subfolders' tokens so a
 * parent theme aggregates the work of its children.
 */
export function smartGroupsFromFolders(folders: FolderInput[]): SmartGroup[] {
  // 1. Index subfolder tokens by top-level folder name (for aggregation).
  const childrenTokensByRoot = new Map<string, Set<string>>();
  for (const f of folders) {
    const segments = f.path.split("/").filter(Boolean);
    if (segments.length <= 1) continue;
    const root = segments[0];
    const bucket = childrenTokensByRoot.get(root) ?? new Set<string>();
    for (const t of tokenize(f.name)) bucket.add(t);
    childrenTokensByRoot.set(root, bucket);
  }

  // 2. Build a group per folder; dedupe by tokens signature.
  const seen = new Set<string>();
  const groups: SmartGroup[] = [];

  // Sort so parents come before children — parents get priority labels.
  const sorted = [...folders].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));

  for (const f of sorted) {
    const ownTokens = tokenize(f.name);
    if (ownTokens.length === 0) continue;

    const depth = f.depth ?? f.path.split("/").length - 1;
    const isRoot = depth === 0;
    const allTokens = new Set<string>(ownTokens);
    if (isRoot) {
      const children = childrenTokensByRoot.get(f.name);
      if (children) for (const t of children) allTokens.add(t);
    }

    const sig = [...allTokens].sort().join("|");
    if (seen.has(sig)) continue;
    seen.add(sig);

    const patterns = [...allTokens].map(
      (t) => new RegExp(`\\b${escapeRe(t)}\\b`, "i"),
    );
    const key = `onedrive:${f.path.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const label = isRoot ? f.name : f.path;

    groups.push({
      key,
      label,
      icon: depthIcon(depth),
      match: (_e, { hay }) => patterns.some((p) => p.test(hay)),
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function ctxFor(e: CachedEmail) {
  const from = (e.from_address ?? "").toLowerCase();
  const domain = from.includes("@") ? from.split("@")[1] : "";
  const hay = [
    e.subject ?? "",
    e.from_name ?? "",
    e.from_address ?? "",
    e.body_text ?? "",
    e.ai_summary ?? "",
    e.ai_category ?? "",
    (e.labels ?? []).join(" "),
  ]
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "");
  return { from, domain, hay };
}

/**
 * Returns the first matching group key for an email, or null.
 * OneDrive folder themes (extraGroups) are evaluated FIRST; built-in
 * fallback groups only catch emails not classified by any folder theme.
 */
export function classifyEmail(
  e: CachedEmail,
  extraGroups: SmartGroup[] = [],
): string | null {
  const ctx = ctxFor(e);
  for (const g of extraGroups) if (g.match(e, ctx)) return g.key;
  for (const g of SMART_GROUPS) if (g.match(e, ctx)) return g.key;
  return null;
}

export function countByGroup(
  emails: CachedEmail[],
  extraGroups: SmartGroup[] = [],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of emails) {
    const k = classifyEmail(e, extraGroups);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
