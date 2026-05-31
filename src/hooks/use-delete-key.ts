import { useEffect } from "react";

/**
 * Déclenche `onDelete` quand la touche Suppr (Delete) est pressée,
 * sauf si le focus est dans un champ de saisie.
 */
export function useDeleteKey(enabled: boolean, onDelete: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Delete") return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
      }
      e.preventDefault();
      onDelete();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, onDelete]);
}
