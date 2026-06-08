import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, User, Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { smartScore } from "@/lib/smart-search";
import type { CachedEmail } from "@/lib/inbox-cache";

type Email = CachedEmail;

type Suggestion = {
  text: string;
  type: "sender" | "subject";
  score: number;
};

export function InboxSearchInput({
  emails,
  value,
  onChange,
  className,
}: {
  emails: Email[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo<Suggestion[]>(() => {
    const q = value.trim();
    if (!q || q.length < 1) return [];

    const seen = new Set<string>();
    const pool: { text: string; type: "sender" | "subject" }[] = [];

    for (const e of emails) {
      if (e.from_address) {
        const key = `sender:${e.from_address.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          const label = e.from_name
            ? `${e.from_name} <${e.from_address}>`
            : e.from_address;
          pool.push({ text: label, type: "sender" });
        }
      }
      if (e.subject) {
        const key = `subject:${e.subject.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          pool.push({ text: e.subject, type: "subject" });
        }
      }
    }

    const scored = pool
      .map((p) => ({ ...p, score: smartScore(q, p.text) }))
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    return scored;
  }, [emails, value]);

  useEffect(() => {
    setHighlight(0);
  }, [suggestions.length]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const apply = (text: string) => {
    onChange(text);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      apply(suggestions[highlight].text);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={value}
        placeholder="Rechercher dans cette boîte…"
        className="h-8 pl-8 pr-8 text-sm"
        onChange={(e) => {
          onChange(e.target.value);
          if (e.target.value.trim()) setOpen(true);
          else setOpen(false);
        }}
        onFocus={() => {
          if (value.trim()) setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
          aria-label="Effacer"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover text-sm shadow-md">
          {suggestions.map((s, i) => (
            <li key={`${s.type}-${s.text}`}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 truncate px-3 py-2 text-left hover:bg-accent",
                  i === highlight && "bg-accent"
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  apply(s.text);
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                {s.type === "sender" ? (
                  <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{s.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
