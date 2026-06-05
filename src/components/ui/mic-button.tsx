import { Mic, MicOff } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { useVoiceDictation } from "@/hooks/use-voice-dictation";
import { toast } from "sonner";

type Target = HTMLInputElement | HTMLTextAreaElement;

/**
 * Écrit `value` dans un input/textarea géré par React (controlled OU uncontrolled)
 * en appelant le setter natif puis en dispatchant un input event — c'est la
 * seule manière fiable d'avertir React d'un changement programmatique.
 */
function setNativeValue(el: Target, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

type Props = {
  /** Ref vers l'élément de saisie cible. */
  targetRef: React.RefObject<Target | null>;
  className?: string;
  /** Taille de l'icône en px. */
  iconSize?: number;
  /** Libellé accessible. */
  title?: string;
};

export function MicButton({ targetRef, className, iconSize = 14, title }: Props) {
  // On garde un petit buffer pour insérer chaque segment final à la suite,
  // avec une espace de séparation propre.
  const lastInterimLen = useRef(0);

  const appendText = (chunk: string, isInterim = false) => {
    const el = targetRef.current;
    if (!el) return;
    const current = el.value ?? "";
    // Retire la dernière prévisualisation interim si présente.
    const base = lastInterimLen.current > 0
      ? current.slice(0, current.length - lastInterimLen.current)
      : current;
    const sep = base && !/\s$/.test(base) ? " " : "";
    const next = base + sep + chunk;
    setNativeValue(el, next);
    lastInterimLen.current = isInterim ? (sep + chunk).length : 0;
    // Garde le curseur en fin.
    try { el.setSelectionRange(next.length, next.length); } catch { /* noop */ }
  };

  const { listening, supported, toggle } = useVoiceDictation({
    onInterim: (txt) => appendText(txt, true),
    onFinal: (txt) => appendText(txt, false),
    onError: (err) => {
      lastInterimLen.current = 0;
      if (err === "not-allowed" || err === "service-not-allowed") {
        toast.error("Microphone refusé. Autorise l'accès dans le navigateur.");
      } else if (err === "no-speech") {
        // silencieux — pas de toast pour ce cas fréquent
      } else if (err === "unsupported") {
        toast.error("Dictée vocale non supportée par ce navigateur.");
      } else if (err !== "aborted") {
        toast.error(`Dictée : ${err}`);
      }
    },
  });

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!listening) lastInterimLen.current = 0;
        toggle();
        // Garde le focus dans le champ pour continuer à taper.
        targetRef.current?.focus();
      }}
      onMouseDown={(e) => e.preventDefault()}
      title={title ?? (listening ? "Arrêter la dictée" : "Dictée vocale")}
      aria-label={listening ? "Arrêter la dictée vocale" : "Démarrer la dictée vocale"}
      className={cn(
        "inline-flex items-center justify-center rounded-md p-1 transition-colors",
        listening
          ? "bg-red-500 text-white animate-pulse"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {listening ? <MicOff style={{ width: iconSize, height: iconSize }} /> : <Mic style={{ width: iconSize, height: iconSize }} />}
    </button>
  );
}
