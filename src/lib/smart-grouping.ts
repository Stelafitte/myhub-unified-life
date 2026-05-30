// Smart auto-grouping of emails by theme / recipient organization.
// Rules-based, runs client-side on cached emails so it works offline.

import type { CachedEmail } from "@/lib/inbox-cache";

export type SmartGroup = {
  key: string;
  label: string;
  icon: string; // emoji
  /** Returns true if this email belongs to the group. */
  match: (e: CachedEmail, ctx: { hay: string; from: string; domain: string }) => boolean;
};

const COMMERCIAL_KEYWORDS = [
  "newsletter", "unsubscribe", "se désabonner", "désinscription",
  "promo", "promotion", "soldes", "offre", "réduction", "code promo",
  "marketing", "campagne", "nouveauté", "exclusif", "black friday",
];

const IT_PROVIDER_DOMAINS = [
  "ovh.com", "ovh.net", "ovhcloud.com",
  "microsoft.com", "office.com", "office365.com", "outlook.com", "azure.com", "microsoftonline.com",
  "google.com", "googlemail.com", "gmail.com", "googleapis.com", "googlecloud.com",
  "apple.com", "icloud.com",
  "github.com", "gitlab.com", "bitbucket.org",
  "vercel.com", "netlify.com", "cloudflare.com",
  "aws.amazon.com", "amazonaws.com", "amazon.com",
  "scaleway.com", "gandi.net", "ionos.fr", "ionos.com", "ovh.ie",
  "adobe.com", "dropbox.com", "slack.com", "zoom.us", "atlassian.com",
  "notion.so", "supabase.com", "supabase.io",
  "openai.com", "anthropic.com",
  "lovable.dev", "lovable.app",
  "wordpress.com", "wpengine.com", "shopify.com",
  "stripe.com", "paypal.com",
];

const IT_PROVIDER_KEYWORDS = [
  "facture", "abonnement", "renouvellement", "domaine", "hébergement",
  "serveur", "ssl", "certificat", "licence",
];

const ORG_GROUPS: Array<{
  key: string;
  label: string;
  icon: string;
  patterns: RegExp[];
}> = [
  {
    key: "sfc",
    label: "SFC",
    icon: "🩺",
    patterns: [/\bsfc\b/i, /société française de cardiologie/i, /sfcardio/i],
  },
  {
    key: "odp2c",
    label: "ODP2C",
    icon: "🏥",
    patterns: [/\bodp2c\b/i, /odp\s*2\s*c/i],
  },
  {
    key: "cardiorisq",
    label: "Cardiorisq (CRK)",
    icon: "❤️",
    patterns: [/cardiorisq/i, /\bcrk\b/i],
  },
  {
    key: "cnpcv",
    label: "CNPCV",
    icon: "🏛️",
    patterns: [/\bcnpcv\b/i, /\bcnp\s*cv\b/i],
  },
];

function buildBaseGroups(): SmartGroup[] {
  const groups: SmartGroup[] = [];

  // Org-specific groups (highest priority)
  for (const og of ORG_GROUPS) {
    groups.push({
      key: og.key,
      label: og.label,
      icon: og.icon,
      match: (_e, { hay }) => og.patterns.some((p) => p.test(hay)),
    });
  }

  // IT providers / prestataires
  groups.push({
    key: "prestataires",
    label: "Prestataires IT",
    icon: "🛠️",
    match: (_e, { domain, hay }) => {
      if (IT_PROVIDER_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) return true;
      // Domain hint + provider keyword
      if (IT_PROVIDER_KEYWORDS.some((k) => hay.includes(k)) &&
          /(ovh|microsoft|azure|google|aws|amazon|scaleway|gandi|ionos|cloudflare|github|stripe|adobe)/i.test(hay)) {
        return true;
      }
      return false;
    },
  });

  // Commercial / marketing
  groups.push({
    key: "commerciales",
    label: "Infos commerciales",
    icon: "🛒",
    match: (e, { hay }) => {
      if (e.ai_category === "newsletter") return true;
      return COMMERCIAL_KEYWORDS.some((k) => hay.includes(k));
    },
  });

  return groups;
}

export const SMART_GROUPS: SmartGroup[] = buildBaseGroups();

/** Stop-words to skip when turning a OneDrive folder name into a theme. */
const FOLDER_STOP = new Set([
  "documents", "document", "perso", "personnel", "personal", "divers",
  "archive", "archives", "backup", "tmp", "temp", "old", "images", "photos",
  "vidéos", "videos", "musique", "music", "downloads", "téléchargements",
  "desktop", "bureau", "shared", "partagé", "partages", "attachments",
  "pièces jointes", "pieces jointes",
]);

/** Tokenize a folder name (path) into useful search terms. */
function folderTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[\\/\s_\-–—.,()[\]]+/)
    .filter((t) => t.length >= 3 && !FOLDER_STOP.has(t));
}

/**
 * Build extra smart groups from OneDrive folder names.
 * A folder becomes a theme; emails matching any of its tokens go into it.
 * Skips folders that overlap with built-in org groups (case-insensitive label).
 */
export function smartGroupsFromFolders(
  folders: { name: string; path: string }[],
): SmartGroup[] {
  const reservedLabels = new Set(SMART_GROUPS.map((g) => g.label.toLowerCase()));
  const seen = new Set<string>();
  const out: SmartGroup[] = [];

  for (const f of folders) {
    const tokens = folderTokens(f.name);
    if (tokens.length === 0) continue;
    const key = `onedrive:${tokens.join("-")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (reservedLabels.has(f.name.toLowerCase())) continue;

    const patterns = tokens.map(
      (t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
    );
    out.push({
      key,
      label: f.name,
      icon: "📁",
      match: (_e, { hay }) => patterns.some((p) => p.test(hay)),
    });
  }
  return out;
}

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
  ].join(" ").toLowerCase();
  return { from, domain, hay };
}

/**
 * Returns the first matching group key for an email, or null.
 * `extraGroups` (e.g. from OneDrive) are evaluated AFTER built-ins
 * so explicit org rules keep priority.
 */
export function classifyEmail(
  e: CachedEmail,
  extraGroups: SmartGroup[] = [],
): string | null {
  const ctx = ctxFor(e);
  for (const g of SMART_GROUPS) if (g.match(e, ctx)) return g.key;
  for (const g of extraGroups) if (g.match(e, ctx)) return g.key;
  return null;
}

/** Count emails per smart group (built-ins + optional extras). */
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

