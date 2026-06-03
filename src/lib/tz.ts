/**
 * Utilitaires fuseau horaire — utilisables côté serveur (Worker UTC) ET client.
 *
 * IMPORTANT (bug historique) : `new Date().getTimezoneOffset()` renvoie l'offset
 * du runtime. Sur le Worker Cloudflare, c'est toujours UTC (offset 0), même si
 * l'utilisateur est à Paris. Pour toute logique destinée à raisonner en heure
 * locale d'un utilisateur côté serveur (prompts IA, formatage d'événements…),
 * utiliser `getZoneOffsetString(tz)` au lieu de `getTimezoneOffset()`.
 */

export const DEFAULT_TZ = "Europe/Paris";

/**
 * Retourne l'offset ISO ("+02:00", "-05:00") d'un fuseau IANA à l'instant donné,
 * en tenant compte de l'heure d'été. Fonctionne en runtime UTC.
 */
export function getZoneOffsetString(timeZone: string = DEFAULT_TZ, at: Date = new Date()): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(at).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const diffMin = Math.round((asUTC - at.getTime()) / 60000);
  const sign = diffMin >= 0 ? "+" : "-";
  const abs = Math.abs(diffMin);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Bloc d'instructions standard à injecter dans les prompts IA qui manipulent
 * des dates/heures évoquées en langage naturel par l'utilisateur.
 */
export function buildTzPromptHint(timeZone: string = DEFAULT_TZ, at: Date = new Date()): string {
  const offset = getZoneOffsetString(timeZone, at);
  return `Fuseau horaire de l'utilisateur : ${timeZone} (offset UTC ${offset}).
IMPORTANT : toute heure mentionnée dans le contenu est en heure locale ${timeZone} sauf indication explicite contraire.
Pour tout champ ISO8601 retourné, utilise l'offset exact ${offset} (ex: 2026-06-05T15:00:00${offset}).
N'utilise JAMAIS le suffixe "Z" ni un offset différent de ${offset}, sauf si la source mentionne explicitement un autre fuseau.`;
}
