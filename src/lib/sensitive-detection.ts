/**
 * Détection RGPD/HDS de contenu de santé dans un email.
 * Pure TS, zéro dépendance — utilisable en edge function (Deno) ET en client.
 * Aucune donnée n'est envoyée à une API externe.
 */

export type SensitivityLevel = "strict" | "normal" | "permissive";

export interface SensitiveCheckInput {
  subject?: string | null;
  from_address?: string | null;
  body_text?: string | null;
  attachment_names?: string[];
}

export interface SensitiveCheckResult {
  isSensitive: boolean;
  score: number; // 0-100
  reasons: string[];
}

// Mots-clés médicaux explicites (poids élevé)
const MEDICAL_KEYWORDS_STRONG = [
  "nip", "ipp", "numéro de séjour", "numero de sejour",
  "diagnostic", "ordonnance", "compte-rendu opératoire", "compte rendu operatoire", "cro",
  "biologie", "imagerie", "scanner", "irm", "pathologie", "posologie",
  "anesthésie", "anesthesie", "chirurgie", "dossier médical", "dossier medical",
  "dmp", "hsa", "pmsi", "cim-10", "cim10", "ccam",
];

// Mots-clés faibles (poids modéré, demandent corroboration)
const MEDICAL_KEYWORDS_WEAK = [
  "patient", "traitement", "résultat", "resultat", "consultation",
  "prescription", "examen", "radiologie", "biopsie", "tumeur",
  "cardio", "néphro", "nephro", "onco", "neuro", "pédiatrie", "pediatrie",
];

// Domaines médico-sociaux
const SUSPECT_DOMAINS = [
  /@mssante\.fr$/i,
  /@chu-[a-z0-9-]+\.fr$/i,
  /@ch-[a-z0-9-]+\.fr$/i,
  /@aphp\.fr$/i,
  /@ap-hm\.fr$/i,
  /@ap-hp\.fr$/i,
];

// Numéro de sécurité sociale français (15 chiffres, format souple)
const NSS_REGEX = /\b[12]\s?\d{2}\s?(0[1-9]|1[0-2]|2\d|3\d|4\d|5\d|6\d|7\d|8\d|9\d)\s?(\d{2}|2[ab])\s?\d{3}\s?\d{3}\s?\d{2}\b/i;

// Patterns numéro dossier patient / NIP (8-15 chiffres avec contexte)
const NIP_CONTEXT_REGEX = /\b(nip|ipp|n[°o]\s*(?:dossier|patient|s[ée]jour))\s*[:#]?\s*[a-z0-9-]{4,20}\b/i;

// Code CIM-10 (ex: J45.0, C50.911)
const CIM10_REGEX = /\b[A-TV-Z]\d{2}(\.\d{1,3})?\b/;

// Patterns noms de fichiers médicaux
const MEDICAL_FILENAME_REGEX = /(ordonnance|cr[-_]?op|compte[-_]?rendu|biologie|imagerie|scanner|irm|radio|dossier|patient|prescription|analyse)/i;

function countMatches(text: string, keywords: string[]): { count: number; matched: string[] } {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  for (const kw of keywords) {
    if (lower.includes(kw)) matched.push(kw);
  }
  return { count: matched.length, matched };
}

export function detectSensitive(
  input: SensitiveCheckInput,
  level: SensitivityLevel = "normal",
  whitelist: string[] = [],
  blacklist: string[] = [],
): SensitiveCheckResult {
  const reasons: string[] = [];
  let score = 0;

  const from = (input.from_address ?? "").toLowerCase();
  const subject = input.subject ?? "";
  const body = input.body_text ?? "";
  const text = `${subject}\n${body}`;
  const attachments = input.attachment_names ?? [];

  // Liste blanche : court-circuit total
  if (from && whitelist.some((w) => from === w.toLowerCase() || from.endsWith(`@${w.toLowerCase()}`))) {
    return { isSensitive: false, score: 0, reasons: ["whitelist"] };
  }

  // Liste noire : sensible d'office
  if (from && blacklist.some((b) => from === b.toLowerCase() || from.endsWith(`@${b.toLowerCase()}`))) {
    return { isSensitive: true, score: 100, reasons: ["blacklist expéditeur"] };
  }

  // Domaine suspect
  if (SUSPECT_DOMAINS.some((rx) => rx.test(from))) {
    score += 50;
    reasons.push("domaine médico-social");
  }

  // NSS
  if (NSS_REGEX.test(text)) {
    score += 60;
    reasons.push("numéro sécurité sociale");
  }

  // NIP / dossier patient avec contexte
  if (NIP_CONTEXT_REGEX.test(text)) {
    score += 50;
    reasons.push("identifiant patient (NIP/IPP)");
  }

  // Code CIM-10 (faible signal seul, fort si combiné)
  if (CIM10_REGEX.test(text)) {
    score += 20;
    reasons.push("code CIM-10");
  }

  // Mots-clés forts
  const strong = countMatches(text, MEDICAL_KEYWORDS_STRONG);
  if (strong.count > 0) {
    score += Math.min(60, strong.count * 20);
    reasons.push(`mots-clés médicaux: ${strong.matched.slice(0, 3).join(", ")}`);
  }

  // Mots-clés faibles
  const weak = countMatches(text, MEDICAL_KEYWORDS_WEAK);
  if (weak.count >= 2) {
    score += Math.min(30, weak.count * 8);
    reasons.push(`termes médicaux multiples (${weak.count})`);
  }

  // Pièces jointes
  const medFiles = attachments.filter((n) => MEDICAL_FILENAME_REGEX.test(n));
  if (medFiles.length > 0) {
    score += 30;
    reasons.push(`pièces jointes suspectes: ${medFiles.slice(0, 2).join(", ")}`);
  }

  // Seuils selon sensibilité
  const threshold = level === "strict" ? 25 : level === "normal" ? 45 : 70;

  return {
    isSensitive: score >= threshold,
    score: Math.min(100, score),
    reasons,
  };
}
