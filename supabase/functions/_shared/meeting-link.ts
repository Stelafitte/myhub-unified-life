// Détection systématique de liens de réunion en ligne dans un email.
// Utilisé par sync-gmail, sync-imap, sync-outlook.
const RX = /https?:\/\/(?:[a-z0-9-]+\.)?(?:zoom\.us|teams\.microsoft\.com|teams\.live\.com|meet\.google\.com|webex\.com|gotomeeting\.com|whereby\.com|gotomeet\.me|bluejeans\.com|meet\.jit\.si|chime\.aws|8x8\.vc|around\.co)\/[^\s"'<>)]+/i;

export function extractMeetingLink(text: string | null | undefined, html?: string | null): string | null {
  const sources = [text ?? "", html ?? ""];
  for (const s of sources) {
    const m = s.match(RX);
    if (m) {
      // Trim trailing punctuation et entités HTML communes
      return m[0].replace(/[.,;:!?)\]"']+$/, "").replace(/&amp;/g, "&");
    }
  }
  return null;
}
