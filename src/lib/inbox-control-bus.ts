// Tiny event bus pour piloter l'inbox depuis l'assistant vocal.
// Évite un aller-retour LLM : la détection se fait côté client et l'inbox
// réagit instantanément.

export type InboxControlEvent =
  | { type: "next" }
  | { type: "prev" }
  | { type: "first" }
  | { type: "last" }
  | { type: "close" }
  | { type: "delete-current" }
  | { type: "archive-current" }
  | { type: "mark-read" }
  | { type: "mark-unread" };

type Listener = (e: InboxControlEvent) => void;

const listeners = new Set<Listener>();

export function subscribeInboxControl(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitInboxControl(e: InboxControlEvent): void {
  for (const l of Array.from(listeners)) {
    try { l(e); } catch (err) { console.error("inbox-control listener error", err); }
  }
}

// Sélection courante (email ouvert dans le lecteur). Mis à jour par l'inbox,
// lu par l'assistant pour cibler les actions ("supprime ce mail").
let currentSelectedEmailId: string | null = null;
export function setCurrentInboxSelection(id: string | null): void {
  currentSelectedEmailId = id;
}
export function getCurrentInboxSelection(): string | null {
  return currentSelectedEmailId;
}

export function hasInboxControlListeners(): boolean {
  return listeners.size > 0;
}

/**
 * Détecte une commande de navigation/contrôle dans une phrase libre.
 * Retourne l'événement à émettre, ou null si aucune commande reconnue.
 */
export function detectInboxControl(text: string): InboxControlEvent | null {
  const t = text.toLowerCase().trim();

  // Fermer / retour à la liste
  if (/\b(ferme|fermer|retour( à la liste)?|quitte|quitter|liste)\b/.test(t)
      && !/\b(mail|email|message)\b.*\b(suivant|précédent|precedent)\b/.test(t)) {
    if (/\b(ferme|fermer|quitte|quitter|retour|liste)\b/.test(t)) return { type: "close" };
  }

  // Premier / dernier
  if (/\b(premier|première)\b.*\b(mail|email|message)\b/.test(t)
      || /^(premier|première)$/.test(t)) return { type: "first" };
  if (/\b(dernier|dernière)\b.*\b(mail|email|message)\b/.test(t)
      || /^(dernier|dernière)$/.test(t)) return { type: "last" };

  // Suivant
  if (/\b(suivant|prochain|prochaine)\b/.test(t)) return { type: "next" };
  // Précédent
  if (/\b(précédent|precedent|précédente|precedente|avant)\b/.test(t)) return { type: "prev" };

  return null;
}
