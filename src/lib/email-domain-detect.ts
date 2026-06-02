// Détection automatique du fournisseur email à partir du domaine.
// Utilisé exclusivement par le wizard d'onboarding.

export type DetectedProvider =
  | { kind: "oauth"; provider: "gmail" | "outlook"; label: string; icon: string }
  | {
      kind: "imap";
      label: string;
      icon: string;
      server: string;
      port: number;
      ssl: true;
    }
  | {
      kind: "exchange-redirect";
      label: string;
      icon: string;
      webmailUrl?: string;
      hint: string;
    }
  | {
      kind: "imap-or-redirect";
      label: string;
      icon: string;
      server: string;
      port: number;
      ssl: true;
      hint: string;
    }
  | { kind: "unknown"; label: string; icon: string };

export function detectEmailProvider(email: string): DetectedProvider {
  const clean = email.trim().toLowerCase();
  const at = clean.lastIndexOf("@");
  if (at < 0 || at === clean.length - 1) {
    return { kind: "unknown", label: "Domaine inconnu", icon: "📧" };
  }
  const domain = clean.slice(at + 1);

  if (domain === "gmail.com" || domain === "googlemail.com") {
    return { kind: "oauth", provider: "gmail", label: "Google", icon: "📧" };
  }
  if (["outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "live.com", "live.fr", "msn.com"].includes(domain)) {
    return { kind: "oauth", provider: "outlook", label: "Microsoft", icon: "📨" };
  }
  if (domain.endsWith("yahoo.com") || domain.endsWith("yahoo.fr")) {
    return { kind: "imap", label: "Yahoo Mail", icon: "📧", server: "imap.mail.yahoo.com", port: 993, ssl: true };
  }
  if (domain === "orange.fr" || domain === "wanadoo.fr") {
    return { kind: "imap", label: "Orange", icon: "🟠", server: "imap.orange.fr", port: 993, ssl: true };
  }
  if (domain === "free.fr") {
    return { kind: "imap", label: "Free", icon: "🆓", server: "imap.free.fr", port: 993, ssl: true };
  }
  if (domain === "sfr.fr" || domain === "neuf.fr") {
    return { kind: "imap", label: "SFR / Neuf", icon: "📧", server: "imap.sfr.fr", port: 993, ssl: true };
  }
  if (domain === "laposte.net") {
    return { kind: "imap", label: "La Poste", icon: "✉️", server: "imap.laposte.net", port: 993, ssl: true };
  }
  if (["icloud.com", "me.com", "mac.com"].includes(domain)) {
    return { kind: "imap", label: "iCloud Mail", icon: "🍎", server: "imap.mail.me.com", port: 993, ssl: true };
  }

  // Établissements de santé français
  if (/(^|\.)(chu|chr|ch)-[^.]+\.fr$/.test(domain) || /(^|\.)ap-hp\.fr$/.test(domain)) {
    return {
      kind: "exchange-redirect",
      label: "Établissement de santé (Exchange)",
      icon: "🏥",
      hint: "Les CHU utilisent Microsoft Exchange en interne — la redirection est la solution la plus fiable.",
    };
  }

  // Universités / académies françaises
  if (/(^|\.)(univ|u)-[^.]+\.fr$/.test(domain) || /(^|\.)ac-[^.]+\.fr$/.test(domain)) {
    return {
      kind: "imap-or-redirect",
      label: "Université / Académie",
      icon: "🎓",
      server: `imap.${domain}`,
      port: 993,
      ssl: true,
      hint: "Beaucoup d'universités exposent un IMAP — sinon configurez une redirection.",
    };
  }

  return { kind: "unknown", label: "Domaine inconnu", icon: "📧" };
}

export function suggestDisplayName(email: string, p: DetectedProvider): string {
  const local = email.split("@")[0] ?? "";
  if (p.kind === "oauth") return p.provider === "gmail" ? `Gmail (${email})` : `Outlook (${email})`;
  if ("label" in p) return `${p.label} — ${local}`;
  return email;
}

export function suggestIcon(p: DetectedProvider): string {
  return "icon" in p ? p.icon : "📧";
}
