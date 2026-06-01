// Signatures automatiques pour les emails sortants.
// Détection basée sur le nom du compte ou ses credentials.

export const PRO_SIGNATURE = `Pr Stéphane Lafitte
Service UMCV
Département Echocardiographie
CHU et Université de Bordeaux`;

export const PERSO_SIGNATURE = `Stéphane Lafitte`;

const SIGNATURE_SEPARATOR = "-- ";

const PRO_PATTERNS: RegExp[] = [
  /stelafitte@outlook\.fr/i,
  /chu/i,
  /echocardio/i,
];

export type SignatureAccount = {
  name?: string | null;
  type?: string | null;
  credentials?: Record<string, unknown> | null;
} | null | undefined;

export function getSignatureForAccount(account: SignatureAccount): string {
  if (!account) return PERSO_SIGNATURE;
  const creds = account.credentials ?? {};
  const candidates = [
    account.name ?? "",
    (creds.username as string | undefined) ?? "",
    (creds.email as string | undefined) ?? "",
    (creds.address as string | undefined) ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return PRO_PATTERNS.some((p) => p.test(candidates)) ? PRO_SIGNATURE : PERSO_SIGNATURE;
}

/** Retire toute signature connue (pro ou perso) en fin de corps. */
function stripKnownSignature(body: string): string {
  let out = body.replace(/\s+$/g, "");
  for (const sig of [PRO_SIGNATURE, PERSO_SIGNATURE]) {
    const marker = `\n${SIGNATURE_SEPARATOR}\n${sig}`;
    const idx = out.lastIndexOf(marker);
    if (idx >= 0 && idx > out.length - marker.length - 4) {
      out = out.slice(0, idx).replace(/\s+$/g, "");
    } else if (out.endsWith(sig)) {
      out = out.slice(0, -sig.length).replace(/\s+$/g, "");
      if (out.endsWith(SIGNATURE_SEPARATOR.trim())) {
        out = out.slice(0, -SIGNATURE_SEPARATOR.trim().length).replace(/\s+$/g, "");
      }
    }
  }
  return out;
}

/** Garantit que `body` se termine par la signature donnée, sans la dupliquer. */
export function applySignature(body: string, signature: string): string {
  const stripped = stripKnownSignature(body ?? "");
  const head = stripped.length > 0 ? `${stripped}\n\n` : "";
  return `${head}${SIGNATURE_SEPARATOR}\n${signature}\n`;
}
