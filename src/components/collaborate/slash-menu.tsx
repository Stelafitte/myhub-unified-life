import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code2,
  Minus,
  Table as TableIcon,
  Sparkles,
  Mic,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { EditorialAction } from "@/lib/collab-ai.functions";

export interface SlashItem {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
  /** kind === "format" => mutates editor directly. kind === "ai" => opens AI dialog. kind === "voice" => toggles dictation. */
  kind: "format" | "ai" | "voice";
  action?: EditorialAction;
  run?: (editor: Editor) => void;
}

const FORMAT_ITEMS: SlashItem[] = [
  {
    id: "h1",
    label: "Titre 1",
    description: "Grand titre de section",
    icon: Heading1,
    keywords: ["titre", "heading", "h1"],
    kind: "format",
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "h2",
    label: "Titre 2",
    description: "Sous-titre",
    icon: Heading2,
    keywords: ["titre", "heading", "h2"],
    kind: "format",
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "h3",
    label: "Titre 3",
    description: "Petit titre",
    icon: Heading3,
    keywords: ["titre", "heading", "h3"],
    kind: "format",
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: "p",
    label: "Paragraphe",
    description: "Texte normal",
    icon: Type,
    keywords: ["paragraphe", "texte", "p"],
    kind: "format",
    run: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    id: "ul",
    label: "Liste à puces",
    description: "Liste non ordonnée",
    icon: List,
    keywords: ["liste", "bullet", "ul"],
    kind: "format",
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: "ol",
    label: "Liste numérotée",
    description: "Liste ordonnée",
    icon: ListOrdered,
    keywords: ["liste", "ordered", "ol", "numero"],
    kind: "format",
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "quote",
    label: "Citation",
    description: "Bloc de citation",
    icon: Quote,
    keywords: ["citation", "quote"],
    kind: "format",
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "code",
    label: "Bloc de code",
    description: "Code monospace",
    icon: Code2,
    keywords: ["code"],
    kind: "format",
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "hr",
    label: "Séparateur",
    description: "Ligne horizontale",
    icon: Minus,
    keywords: ["separateur", "hr", "divider"],
    kind: "format",
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    id: "table",
    label: "Tableau",
    description: "Insère un tableau 3×3",
    icon: TableIcon,
    keywords: ["tableau", "table"],
    kind: "format",
    run: (e) =>
      e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];

const AI_ITEMS: SlashItem[] = [
  { id: "ai-improve", label: "IA · Améliorer", description: "Améliorer la sélection", icon: Sparkles, keywords: ["ia", "ameliorer"], kind: "ai", action: "improve" },
  { id: "ai-shorten", label: "IA · Raccourcir", description: "Réduire la sélection", icon: Sparkles, keywords: ["ia", "raccourcir"], kind: "ai", action: "shorten" },
  { id: "ai-lengthen", label: "IA · Allonger", description: "Développer la sélection", icon: Sparkles, keywords: ["ia", "allonger"], kind: "ai", action: "lengthen" },
  { id: "ai-simplify", label: "IA · Simplifier", description: "Simplifier la sélection", icon: Sparkles, keywords: ["ia", "simplifier"], kind: "ai", action: "simplify" },
  { id: "ai-fix", label: "IA · Corriger l'orthographe", description: "Grammaire / ponctuation", icon: Sparkles, keywords: ["ia", "corriger", "orthographe"], kind: "ai", action: "fix_grammar" },
  { id: "ai-tone", label: "IA · Changer le ton", description: "Adapter le ton", icon: Sparkles, keywords: ["ia", "ton"], kind: "ai", action: "change_tone" },
  { id: "ai-translate", label: "IA · Traduire", description: "Traduire la sélection", icon: Sparkles, keywords: ["ia", "traduire"], kind: "ai", action: "translate" },
  { id: "ai-summary", label: "IA · Résumer", description: "Résumé court", icon: Sparkles, keywords: ["ia", "resumer"], kind: "ai", action: "summarize" },
  { id: "ai-bullets", label: "IA · Convertir en puces", description: "Texte → liste", icon: Sparkles, keywords: ["ia", "puces", "liste"], kind: "ai", action: "to_bullets" },
  { id: "ai-continue", label: "IA · Continuer l'écriture", description: "Poursuivre à partir du curseur", icon: Sparkles, keywords: ["ia", "continuer"], kind: "ai", action: "continue" },
];

const VOICE_ITEM: SlashItem = {
  id: "voice",
  label: "Dictée vocale",
  description: "Démarrer la dictée",
  icon: Mic,
  keywords: ["vocal", "dictee", "voice", "mic"],
  kind: "voice",
};

export const ALL_SLASH_ITEMS: SlashItem[] = [...FORMAT_ITEMS, VOICE_ITEM, ...AI_ITEMS];

interface Props {
  editor: Editor;
  open: boolean;
  query: string;
  position: { top: number; left: number } | null;
  onClose: () => void;
  onPickFormat: (item: SlashItem) => void;
  onPickAI: (action: EditorialAction) => void;
  onPickVoice: () => void;
}

export function SlashMenu({
  open,
  query,
  position,
  onClose,
  onPickFormat,
  onPickAI,
  onPickVoice,
}: Props) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_SLASH_ITEMS;
    return ALL_SLASH_ITEMS.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.keywords.some((k) => k.includes(q)),
    );
  }, [query]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const it = items[active];
        if (it) pick(it);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items, active]);

  const pick = (it: SlashItem) => {
    if (it.kind === "format") onPickFormat(it);
    else if (it.kind === "ai" && it.action) onPickAI(it.action);
    else if (it.kind === "voice") onPickVoice();
  };

  if (!open || !position) return null;

  return (
    <div
      ref={listRef}
      className="fixed z-50 w-72 max-h-80 overflow-y-auto rounded-md border bg-popover shadow-lg p-1"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">Aucun résultat</div>
      ) : (
        items.map((it, idx) => {
          const Icon = it.icon;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => pick(it)}
              onMouseEnter={() => setActive(idx)}
              className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-sm text-left text-sm ${
                idx === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              }`}
            >
              <Icon className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{it.label}</div>
                <div className="text-xs text-muted-foreground truncate">{it.description}</div>
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}
