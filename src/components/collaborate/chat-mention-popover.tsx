import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { User } from "lucide-react";
import { searchMentionContacts } from "@/lib/collab.functions";

interface Contact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  organization: string | null;
}

interface Props {
  open: boolean;
  query: string;
  onPick: (name: string) => void;
  onClose: () => void;
}

function contactName(c: Contact): string {
  return (
    [c.first_name, c.last_name].filter(Boolean).join(" ") ||
    c.organization ||
    "Contact"
  );
}

export function ChatMentionPopover({ open, query, onPick, onClose }: Props) {
  const fn = useServerFn(searchMentionContacts);
  const [active, setActive] = useState(0);

  const { data } = useQuery({
    queryKey: ["mention-contacts", query],
    queryFn: () => fn({ data: { q: query } }),
    enabled: open,
  });

  const items = (data?.contacts ?? []) as Contact[];

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
          onPick(contactName(items[active]));
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
      className="absolute bottom-full left-2 mb-1 w-64 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-lg p-1 z-50"
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((c, idx) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(contactName(c))}
          onMouseEnter={() => setActive(idx)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left text-sm ${
            idx === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
          }`}
        >
          <User className="h-3.5 w-3.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{contactName(c)}</div>
            {c.organization && (
              <div className="text-xs text-muted-foreground truncate">{c.organization}</div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
