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
 * Order matters: org groups win over provider/commercial.
 */
export function classifyEmail(e: CachedEmail): string | null {
  const ctx = ctxFor(e);
  for (const g of SMART_GROUPS) {
    if (g.match(e, ctx)) return g.key;
  }
  return null;
}

/** Count emails per smart group. */
export function countByGroup(emails: CachedEmail[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of emails) {
    const k = classifyEmail(e);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** Filter emails belonging to a given group key. */
export function filterByGroup(emails: CachedEmail[], key: string): CachedEmail[] {
  return emails.filter((e) => classifyEmail(e) === key);
}
