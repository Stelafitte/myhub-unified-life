import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

type Suggestion = { email: string; label: string };

/**
 * Champ email simple avec autocomplétion sur les contacts + adresses connues.
 * Utilisé p.ex. dans la liste des participants d'un événement.
 */
export function ContactEmailAutocomplete({
  value,
  onChange,
  onSelect,
  onEnter,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect?: (email: string) => void;
  onEnter?: () => void;
  placeholder?: string;
  className?: string;
}) {
  const { user } = useAuth();
  const [pool, setPool] = useState<Suggestion[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancel = false;
    void (async () => {
      const [contactsRes, emailsRes] = await Promise.all([
        supabase
          .from("contacts")
          .select("first_name,last_name,email")
          .eq("user_id", user.id)
          .limit(2000),
        supabase
          .from("emails")
          .select("from_address,from_name")
          .eq("user_id", user.id)
          .not("from_address", "is", null)
          .order("received_at", { ascending: false })
          .limit(500),
      ]);
      if (cancel) return;
      const map = new Map<string, Suggestion>();
      for (const c of contactsRes.data ?? []) {
        const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
        for (const em of (c.email ?? []) as string[]) {
          if (!em) continue;
          const k = em.toLowerCase();
          if (!map.has(k)) map.set(k, { email: em, label: name ? `${name} <${em}>` : em });
        }
      }
      for (const e of emailsRes.data ?? []) {
        if (!e.from_address) continue;
        const k = e.from_address.toLowerCase();
        if (!map.has(k)) {
          map.set(k, {
            email: e.from_address,
            label: e.from_name ? `${e.from_name} <${e.from_address}>` : e.from_address,
          });
        }
      }
      setPool(Array.from(map.values()));
    })();
    return () => { cancel = true; };
  }, [user]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      // ignore clicks within the portal dropdown
      if ((t as HTMLElement)?.closest?.("[data-contact-ac-pop]")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const refresh = (q: string) => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 1) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const matches = pool
      .filter((s) => s.label.toLowerCase().includes(needle))
      .slice(0, 8);
    setSuggestions(matches);
    setOpen(matches.length > 0);
    setHighlight(0);
  };

  const apply = (email: string) => {
    onChange(email);
    setOpen(false);
    setSuggestions([]);
    onSelect?.(email);
  };

  return (
    <div ref={wrapRef} className={cn("relative flex-1", className)}>
      <Input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        className="h-8 text-sm"
        onChange={(e) => {
          onChange(e.target.value);
          refresh(e.target.value);
        }}
        onFocus={() => refresh(value)}
        onKeyDown={(e) => {
          if (open && suggestions.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => (h + 1) % suggestions.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              apply(suggestions[highlight].email);
              return;
            }
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
          }
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter?.();
          }
        }}
      />
      {open && suggestions.length > 0 && rect && typeof document !== "undefined" && createPortal(
        <ul
          data-contact-ac-pop
          style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width, zIndex: 1000 }}
          className="max-h-56 overflow-y-auto rounded-md border bg-popover text-xs shadow-md"
        >
          {suggestions.map((s, i) => (
            <li key={s.email}>
              <button
                type="button"
                className={cn(
                  "block w-full truncate px-2 py-1.5 text-left hover:bg-accent",
                  i === highlight && "bg-accent",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  apply(s.email);
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
