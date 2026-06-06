import { useEffect, useState } from "react";
import { CheckSquare, CalendarClock, Vote, FileText, Sparkles, type LucideIcon } from "lucide-react";

export type ChatSlashCommand = "tache" | "reunion" | "sondage" | "doc" | "ia";

interface Item {
  id: ChatSlashCommand;
  label: string;
  description: string;
  icon: LucideIcon;
}

const ITEMS: Item[] = [
  { id: "tache", label: "/tache", description: "Créer une tâche liée à cet espace", icon: CheckSquare },
  { id: "reunion", label: "/reunion", description: "Planifier une réunion liée", icon: CalendarClock },
  { id: "sondage", label: "/sondage", description: "Lancer un sondage de créneaux", icon: Vote },
  { id: "doc", label: "/doc", description: "Créer un document collaboratif", icon: FileText },
  { id: "ia", label: "/ia", description: "Ouvrir l'assistant IA", icon: Sparkles },
];

interface Props {
  open: boolean;
  query: string;
  onPick: (id: ChatSlashCommand) => void;
  onClose: () => void;
}

export function ChatSlashMenu({ open, query, onPick, onClose }: Props) {
  const [active, setActive] = useState(0);
  const q = query.toLowerCase();
  const items = ITEMS.filter((i) => !q || i.id.includes(q) || i.label.includes(q));

  useEffect(() => setActive(0), [query, open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (items[active]) {
          e.preventDefault();
          onPick(items[active].id);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [open, items, active, onPick, onClose]);

  if (!open || items.length === 0) return null;

  return (
    <div
      className="absolute bottom-full left-2 mb-1 w-72 max-h-72 overflow-y-auto rounded-md border bg-popover shadow-lg p-1 z-50"
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((it, idx) => {
        const Icon = it.icon;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onPick(it.id)}
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
      })}
    </div>
  );
}
