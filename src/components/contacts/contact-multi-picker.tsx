import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

type Entry = { email: string; name: string; label: string };

export function ContactMultiPicker({
  open,
  onOpenChange,
  excludeEmails = [],
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  excludeEmails?: string[];
  onConfirm: (selected: Array<{ email: string; name: string }>) => void;
}) {
  const { user } = useAuth();
  const [pool, setPool] = useState<Entry[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !user) return;
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
  }, [open, user]);

  useEffect(() => {
    if (!open) { setSelected(new Set()); setQ(""); }
  }, [open]);

  const excluded = useMemo(() => new Set(excludeEmails.map((e) => e.toLowerCase())), [excludeEmails]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return pool
      .filter((p) => !excluded.has(p.email.toLowerCase()))
      .filter((p) => !n || p.label.toLowerCase().includes(n))
      .slice(0, 300);
  }, [pool, q, excluded]);

  const toggle = (em: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(em)) n.delete(em); else n.add(em);
      return n;
    });
  };

  const confirm = () => {
    const out: Array<{ email: string; name: string }> = [];
    for (const p of pool) if (selected.has(p.email)) out.push({ email: p.email, name: p.name });
    onConfirm(out);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajouter des participants</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Rechercher (nom ou email)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-9"
        />
        <div className="max-h-80 overflow-y-auto rounded-md border divide-y">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">Aucun contact</div>
          )}
          {filtered.map((p) => {
            const checked = selected.has(p.email);
            return (
              <label key={p.email} className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent text-sm">
                <Checkbox checked={checked} onCheckedChange={() => toggle(p.email)} />
                <span className="truncate">{p.label}</span>
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <div className="mr-auto text-xs text-muted-foreground self-center">{selected.size} sélectionné(s)</div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={confirm} disabled={selected.size === 0}>Ajouter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
