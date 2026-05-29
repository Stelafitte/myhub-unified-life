import type { DocumentRow } from "@/lib/documents";

export type FolderSuggestion = {
  folder: string;
  score: number;
  reason: string;
  sampleCount: number;
};

type Candidate = {
  filename: string;
  mimeType: string | null;
  fromAddress?: string | null;
  subject?: string | null;
};

const STOP = new Set([
  "le","la","les","un","une","des","de","du","et","ou","pour","par","avec","sans","au","aux",
  "the","a","an","of","to","for","and","or","with","in","on","at","re","fwd","tr",
]);

function tokens(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.toLowerCase()
    .replace(/[^a-z0-9àâäéèêëïîôöùûüç\s]+/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/**
 * Compute folder suggestions from existing documents.
 * Folder = first tag of a document. We score each folder by:
 *  - same sender (+4 per occurrence)
 *  - same mime type or extension (+2)
 *  - matching keyword in description/filename (+1 each, cap 3)
 *  - recency bonus (+1 if used in last 30d)
 */
export function suggestFolders(
  candidate: Candidate,
  docs: DocumentRow[],
  limit = 3,
): FolderSuggestion[] {
  const candTokens = new Set([...tokens(candidate.filename), ...tokens(candidate.subject)]);
  const candExt = ext(candidate.filename);
  const candMime = candidate.mimeType ?? "";
  const sender = (candidate.fromAddress ?? "").toLowerCase();
  const now = Date.now();

  const buckets = new Map<string, { score: number; reasons: Set<string>; count: number }>();

  for (const d of docs) {
    const folder = (d.tags && d.tags[0]) ? d.tags[0] : null;
    if (!folder) continue;

    let s = 0;
    const reasons = new Set<string>();

    // sender match (description often contains "From: x@y" for email-sourced docs)
    if (sender && d.description && d.description.toLowerCase().includes(sender)) {
      s += 4;
      reasons.add(`expéditeur ${sender}`);
    }

    // mime / ext match
    if (candMime && d.mime_type === candMime) {
      s += 2;
      reasons.add("même type de fichier");
    } else if (candExt && ext(d.filename) === candExt) {
      s += 2;
      reasons.add(`fichiers .${candExt}`);
    }

    // keyword overlap
    const docTokens = new Set([
      ...tokens(d.filename),
      ...tokens(d.description),
      ...tokens(folder),
    ]);
    let kw = 0;
    const kwMatches: string[] = [];
    for (const t of candTokens) {
      if (docTokens.has(t)) {
        kw++;
        if (kwMatches.length < 2) kwMatches.push(t);
        if (kw >= 3) break;
      }
    }
    if (kw > 0) {
      s += kw;
      reasons.add(`mots-clés: ${kwMatches.join(", ")}`);
    }

    // recency
    const age = (now - new Date(d.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (age < 30) s += 1;

    if (s === 0) continue;

    const b = buckets.get(folder) ?? { score: 0, reasons: new Set<string>(), count: 0 };
    b.score += s;
    b.count += 1;
    reasons.forEach((r) => b.reasons.add(r));
    buckets.set(folder, b);
  }

  return Array.from(buckets.entries())
    .map(([folder, b]) => ({
      folder,
      score: b.score,
      sampleCount: b.count,
      reason: Array.from(b.reasons).slice(0, 2).join(" · "),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** All distinct folders (primary tags) currently in use, sorted by usage. */
export function listFolders(docs: DocumentRow[]): { folder: string; count: number }[] {
  const m = new Map<string, number>();
  for (const d of docs) {
    const f = d.tags && d.tags[0];
    if (!f) continue;
    m.set(f, (m.get(f) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .map(([folder, count]) => ({ folder, count }))
    .sort((a, b) => b.count - a.count);
}
