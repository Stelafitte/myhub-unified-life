import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

type Entry = { email: string; name: string; label: string };

export function ContactInlinePicker({
  excludeEmails = [],
  onPick,
}: {
  excludeEmails?: string[];
  onPick: (entry: { email: string; name: string }) => void;
}) {
  const { user } = useAuth();
  const [pool, setPool] = useState<Entry[]>([]);
  const [q, setQ] = useState("");

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
      const map = new Map<string, Entry>();
      for (const c of contactsRes.data ?? []) {
        const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
        for (const em of (c.email ?? []) as string[]) {
          if (!em) continue;
          const k = em.toLowerCase();
          if (!map.has(k)) map.set(k, { email: em, name, label: name ? `${name} <${em}>` : em });
        }
      }
      for (const e of emailsRes.data ?? []) {
        if (!e.from_address) continue;
        const k = e.from_address.toLowerCase();
        if (!map.has(k)) {
          map.set(k, {
            email: e.from_address,
            name: e.from_name ?? "",
            label: e.from_name ? `${e.from_name} <${e.from_address}>` : e.from_address,
          });
        }
      }
      setPool(Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label)));
    })();
    return () => { cancel = true; };
  }, [user]);

  const excluded = useMemo(() => new Set(excludeEmails.map((e) => e.toLowerCase())), [excludeEmails]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return pool
      .filter((p) => !excluded.has(p.email.toLowerCase()))
      .filter((p) => !n || p.label.toLowerCase().includes(n))
      .slice(0, 200);
  }, [pool, q, excluded]);

  return (
    <div className="space-y-2">
      <Input
        placeholder="Rechercher un contact (nom ou email)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="h-9"
      />
      <div className="max-h-56 overflow-y-auto rounded-md border divide-y bg-background">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {q ? "Aucun contact — ajoutez l'adresse manuellement ci-dessous." : "Aucun contact"}
          </div>
        ) : (
          filtered.map((p) => (
            <label
              key={p.email}
              className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent text-sm"
              onClick={(e) => {
                e.preventDefault();
                onPick({ email: p.email, name: p.name });
              }}
            >
              <Checkbox checked={false} />
              <span className="truncate">{p.label}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
