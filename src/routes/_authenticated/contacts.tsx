import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Users,
  Search,
  Plus,
  Mail,
  Phone,
  Building2,
  Tag as TagIcon,
  Merge,
  Send,
  Trash2,
  RefreshCw,
  X,
  Check,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/relative-time";

type Contact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  organization: string | null;
  role: string | null;
  email: string[] | null;
  phone: string[] | null;
  avatar_url: string | null;
  notes: string | null;
  tags: string[] | null;
  sources: string[] | null;
  external_ids: unknown;
  created_at: string;
  updated_at: string;
};

type Account = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  last_sync_at: string | null;
};

type EmailRow = {
  id: string;
  subject: string | null;
  from_address: string | null;
  received_at: string | null;
};

type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
};

type SourceKey = "google" | "icloud" | "outlook" | "other";

const SOURCE_META: Record<SourceKey, { label: string; color: string; dot: string }> = {
  google: { label: "Google", color: "bg-blue-500/10 text-blue-600", dot: "bg-blue-500" },
  icloud: { label: "iCloud", color: "bg-zinc-700/10 text-zinc-700 dark:text-zinc-300", dot: "bg-zinc-700" },
  outlook: { label: "Outlook", color: "bg-sky-500/10 text-sky-600", dot: "bg-sky-500" },
  other: { label: "Autre", color: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
};

function detectSourceKey(s: string): SourceKey {
  const v = s.toLowerCase();
  if (v.includes("google") || v.includes("gmail")) return "google";
  if (v.includes("icloud") || v.includes("apple")) return "icloud";
  if (v.includes("outlook") || v.includes("microsoft") || v.includes("ms")) return "outlook";
  return "other";
}

function fullName(c: Contact) {
  return [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || (c.email?.[0] ?? "Sans nom");
}

function initials(c: Contact) {
  const f = (c.first_name ?? "").trim();
  const l = (c.last_name ?? "").trim();
  if (f || l) return ((f[0] ?? "") + (l[0] ?? "")).toUpperCase();
  const e = c.email?.[0] ?? "";
  return e.slice(0, 2).toUpperCase() || "?";
}

export const Route = createFileRoute("/_authenticated/contacts")({
  component: ContactsPage,
});

function ContactsPage() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | SourceKey>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [orgFilter, setOrgFilter] = useState<string>("all");
  const [sort, setSort] = useState<"name" | "org" | "recent">("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastContactMap, setLastContactMap] = useState<Map<string, string>>(new Map());
  const [mergeOpen, setMergeOpen] = useState<{ a: Contact; b: Contact } | null>(null);
  const [loading, setLoading] = useState(true);

  // Load
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: cs }, { data: accs }, { data: ems }] = await Promise.all([
        supabase.from("contacts").select("*").order("last_name", { ascending: true, nullsFirst: false }),
        supabase.from("accounts").select("id,name,type,color,last_sync_at").order("created_at"),
        supabase.from("emails").select("from_address,received_at").order("received_at", { ascending: false }).limit(2000),
      ]);
      if (cancelled) return;
      if (cs) setContacts(cs as Contact[]);
      if (accs) setAccounts(accs as Account[]);
      if (ems) {
        const m = new Map<string, string>();
        for (const e of ems as { from_address: string | null; received_at: string | null }[]) {
          const a = (e.from_address ?? "").toLowerCase();
          if (a && e.received_at && !m.has(a)) m.set(a, e.received_at);
        }
        setLastContactMap(m);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    contacts.forEach((c) => (c.tags ?? []).forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [contacts]);

  const allOrgs = useMemo(() => {
    const s = new Set<string>();
    contacts.forEach((c) => c.organization && s.add(c.organization));
    return Array.from(s).sort();
  }, [contacts]);

  const lastContactedFor = (c: Contact): string | null => {
    let best: string | null = null;
    for (const e of c.email ?? []) {
      const v = lastContactMap.get(e.toLowerCase());
      if (v && (!best || v > best)) best = v;
    }
    return best;
  };

  const filtered = useMemo(() => {
    let list = contacts;
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (c) =>
          fullName(c).toLowerCase().includes(q) ||
          (c.organization ?? "").toLowerCase().includes(q) ||
          (c.email ?? []).some((e) => e.toLowerCase().includes(q)),
      );
    }
    if (sourceFilter !== "all") {
      list = list.filter((c) => (c.sources ?? []).some((s) => detectSourceKey(s) === sourceFilter));
    }
    if (tagFilter !== "all") list = list.filter((c) => (c.tags ?? []).includes(tagFilter));
    if (orgFilter !== "all") list = list.filter((c) => c.organization === orgFilter);

    const sorted = [...list];
    if (sort === "name") {
      sorted.sort((a, b) => fullName(a).localeCompare(fullName(b)));
    } else if (sort === "org") {
      sorted.sort((a, b) => (a.organization ?? "").localeCompare(b.organization ?? ""));
    } else {
      sorted.sort((a, b) => (lastContactedFor(b) ?? "").localeCompare(lastContactedFor(a) ?? ""));
    }
    return sorted;
  }, [contacts, query, sourceFilter, tagFilter, orgFilter, sort, lastContactMap]);

  // Duplicate detection
  const duplicates = useMemo(() => {
    const groups: Contact[][] = [];
    const seen = new Set<string>();
    for (const c of contacts) {
      if (seen.has(c.id)) continue;
      const name = fullName(c).toLowerCase().trim();
      const emails = new Set((c.email ?? []).map((e) => e.toLowerCase()));
      const matches = contacts.filter((other) => {
        if (other.id === c.id) return false;
        if (name && fullName(other).toLowerCase().trim() === name) return true;
        return (other.email ?? []).some((e) => emails.has(e.toLowerCase()));
      });
      if (matches.length > 0) {
        const grp = [c, ...matches];
        grp.forEach((g) => seen.add(g.id));
        groups.push(grp);
      }
    }
    return groups;
  }, [contacts]);

  const selected = useMemo(() => contacts.find((c) => c.id === selectedId) ?? null, [contacts, selectedId]);

  const refresh = async () => {
    const { data } = await supabase.from("contacts").select("*");
    if (data) setContacts(data as Contact[]);
  };

  const removeContact = async (id: string) => {
    if (!confirm("Supprimer ce contact ?")) return;
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setContacts((p) => p.filter((c) => c.id !== id));
    if (selectedId === id) setSelectedId(null);
    toast.success("Contact supprimé");
  };

  const createContact = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("contacts")
      .insert({ user_id: user.id, first_name: "Nouveau", last_name: "Contact" })
      .select()
      .single();
    if (error) return toast.error(error.message);
    setContacts((p) => [data as Contact, ...p]);
    setSelectedId((data as Contact).id);
  };

  return (
    <div className="-mx-4 -my-4 flex h-[calc(100vh-4rem)] overflow-hidden md:-mx-6">
      {/* LEFT — list */}
      <section className="flex min-w-0 flex-1 flex-col border-r">
        {/* Header */}
        <div className="border-b bg-card">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <h1 className="text-base font-semibold">Contacts</h1>
              <Badge variant="secondary" className="text-[10px]">{filtered.length}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={refresh} className="h-8 gap-1">
                <RefreshCw className="h-3.5 w-3.5" /> Actualiser
              </Button>
              <Button size="sm" onClick={createContact} className="h-8 gap-1">
                <Plus className="h-3.5 w-3.5" /> Nouveau
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Nom, email, organisation…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 pl-8"
              />
            </div>
            <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as typeof sourceFilter)}>
              <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes sources</SelectItem>
                <SelectItem value="google">Google</SelectItem>
                <SelectItem value="icloud">iCloud</SelectItem>
                <SelectItem value="outlook">Outlook</SelectItem>
                <SelectItem value="other">Autre</SelectItem>
              </SelectContent>
            </Select>
            <Select value={tagFilter} onValueChange={setTagFilter}>
              <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue placeholder="Tag" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les tags</SelectItem>
                {allTags.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={orgFilter} onValueChange={setOrgFilter}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Organisation" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes orgs</SelectItem>
                {allOrgs.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Tri : nom</SelectItem>
                <SelectItem value="org">Tri : organisation</SelectItem>
                <SelectItem value="recent">Tri : récemment contacté</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sync indicators */}
          <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-4 py-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium">Sync :</span>
            {accounts.length === 0 && <span className="italic">Aucun compte configuré</span>}
            {accounts.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: a.color ?? "#64748b" }} />
                {a.name}
                <span className="opacity-60">· {a.last_sync_at ? relativeTime(a.last_sync_at) : "jamais"}</span>
              </span>
            ))}
          </div>

          {/* Duplicate banner */}
          {duplicates.length > 0 && (
            <div className="flex items-center justify-between gap-2 border-t bg-amber-500/10 px-4 py-1.5 text-xs">
              <span className="text-amber-700 dark:text-amber-400">
                {duplicates.length} groupe{duplicates.length > 1 ? "s" : ""} de doublons détecté{duplicates.length > 1 ? "s" : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 text-amber-700 dark:text-amber-400"
                onClick={() => {
                  const g = duplicates[0];
                  setMergeOpen({ a: g[0], b: g[1] });
                }}
              >
                <Merge className="h-3 w-3" /> Examiner
              </Button>
            </div>
          )}
        </div>

        {/* List */}
        <ul className="flex-1 divide-y overflow-y-auto">
          {loading && <li className="p-8 text-center text-sm text-muted-foreground">Chargement…</li>}
          {!loading && filtered.length === 0 && (
            <li className="p-10 text-center text-sm text-muted-foreground">
              {contacts.length === 0 ? "Aucun contact." : "Aucun résultat."}
            </li>
          )}
          {filtered.map((c) => {
            const isSel = c.id === selectedId;
            const last = lastContactedFor(c);
            return (
              <li
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors",
                  isSel ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <Avatar contact={c} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{fullName(c)}</span>
                    {c.organization && (
                      <span className="truncate text-xs text-muted-foreground">· {c.organization}</span>
                    )}
                    {last && (
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{relativeTime(last)}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs text-muted-foreground">{c.email?.[0] ?? "—"}</span>
                    {c.role && <span className="truncate text-[10px] text-muted-foreground">· {c.role}</span>}
                  </div>
                </div>
                <div className="hidden shrink-0 items-center gap-1 sm:flex">
                  {(c.sources ?? []).slice(0, 3).map((s) => {
                    const k = detectSourceKey(s);
                    const meta = SOURCE_META[k];
                    return (
                      <span
                        key={s}
                        title={meta.label}
                        className={cn("h-2 w-2 rounded-full", meta.dot)}
                      />
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* RIGHT — detail */}
      <aside className="hidden w-[440px] shrink-0 flex-col bg-card lg:flex">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            Sélectionnez un contact pour voir sa fiche
          </div>
        ) : (
          <ContactDetail
            key={selected.id}
            contact={selected}
            accounts={accounts}
            onSave={async (updates) => {
              const { error } = await supabase.from("contacts").update(updates as never).eq("id", selected.id);
              if (error) { toast.error(error.message); return; }
              setContacts((p) => p.map((c) => (c.id === selected.id ? { ...c, ...updates } : c)));
              toast.success("Modifications enregistrées");
            }}
            onDelete={() => removeContact(selected.id)}
          />
        )}
      </aside>

      {mergeOpen && (
        <MergeDialog
          a={mergeOpen.a}
          b={mergeOpen.b}
          onClose={() => setMergeOpen(null)}
          onMerged={async (merged, removedId) => {
            const { error: e1 } = await supabase.from("contacts").update(merged as never).eq("id", merged.id);
            if (e1) return toast.error(e1.message);
            const { error: e2 } = await supabase.from("contacts").delete().eq("id", removedId);
            if (e2) return toast.error(e2.message);
            setContacts((p) => p.filter((c) => c.id !== removedId).map((c) => (c.id === merged.id ? { ...c, ...merged } : c)));
            setMergeOpen(null);
            toast.success("Contacts fusionnés");
          }}
        />
      )}
    </div>
  );
}

function Avatar({ contact }: { contact: Contact }) {
  if (contact.avatar_url) {
    return (
      <img
        src={contact.avatar_url}
        alt={fullName(contact)}
        className="h-9 w-9 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
      {initials(contact)}
    </div>
  );
}

function ContactDetail({
  contact,
  accounts,
  onSave,
  onDelete,
}: {
  contact: Contact;
  accounts: Account[];
  onSave: (updates: Partial<Contact>) => Promise<void>;
  onDelete: () => void;
}) {
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [history, setHistory] = useState<EmailRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeFrom, setComposeFrom] = useState<string>(accounts[0]?.id ?? "");

  useEffect(() => setNotes(contact.notes ?? ""), [contact.id, contact.notes]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const emails = (contact.email ?? []).map((e) => e.toLowerCase());
      if (emails.length === 0) {
        setHistory([]);
        setTasks([]);
        return;
      }
      const [{ data: ems }, { data: tks }] = await Promise.all([
        supabase
          .from("emails")
          .select("id,subject,from_address,received_at")
          .in("from_address", emails)
          .order("received_at", { ascending: false })
          .limit(20),
        supabase
          .from("tasks")
          .select("id,title,status,due_date")
          .in("assigned_to", [...emails, fullName(contact)])
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(20),
      ]);
      if (cancelled) return;
      if (ems) setHistory(ems as EmailRow[]);
      if (tks) setTasks(tks as TaskRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [contact]);

  const primaryEmail = contact.email?.[0];
  const sendEmail = () => {
    if (!primaryEmail) return toast.error("Pas d'adresse email");
    const acc = accounts.find((a) => a.id === composeFrom);
    const mail = `mailto:${primaryEmail}?subject=${encodeURIComponent("")}&body=${encodeURIComponent(
      acc ? `\n\n--\nEnvoyé depuis ${acc.name}` : "",
    )}`;
    window.location.href = mail;
    setComposeOpen(false);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b p-5">
        <div className="flex items-start gap-4">
          <div className="shrink-0">
            {contact.avatar_url ? (
              <img src={contact.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
                {initials(contact)}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold">{fullName(contact)}</div>
            {contact.role && <div className="text-sm text-muted-foreground">{contact.role}</div>}
            {contact.organization && (
              <div className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                <Building2 className="h-3 w-3" /> {contact.organization}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {(contact.sources ?? []).map((s) => {
                const meta = SOURCE_META[detectSourceKey(s)];
                return (
                  <span
                    key={s}
                    className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium", meta.color)}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                    {meta.label}
                  </span>
                );
              })}
              {(contact.sources ?? []).length === 0 && (
                <span className="text-[10px] italic text-muted-foreground">Aucune source synchronisée</span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" className="h-8 gap-1" onClick={() => setComposeOpen(true)} disabled={!primaryEmail}>
            <Send className="h-3.5 w-3.5" /> Envoyer un email
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Supprimer
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-5 overflow-y-auto p-5 text-sm">
        {/* Emails / phones */}
        <Section title="Coordonnées">
          {(contact.email ?? []).map((e, i) => (
            <div key={`e-${i}`} className="flex items-center gap-2 py-0.5">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              <a href={`mailto:${e}`} className="text-primary hover:underline">{e}</a>
              {i === 0 && <Badge variant="secondary" className="text-[9px]">principal</Badge>}
            </div>
          ))}
          {(contact.phone ?? []).map((p, i) => (
            <div key={`p-${i}`} className="flex items-center gap-2 py-0.5">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              <a href={`tel:${p}`} className="hover:underline">{p}</a>
            </div>
          ))}
          {(contact.email ?? []).length === 0 && (contact.phone ?? []).length === 0 && (
            <div className="text-xs italic text-muted-foreground">Aucune coordonnée</div>
          )}
        </Section>

        {/* Tags */}
        {(contact.tags ?? []).length > 0 && (
          <Section title="Tags">
            <div className="flex flex-wrap gap-1">
              {(contact.tags ?? []).map((t) => (
                <Badge key={t} variant="outline" className="gap-1 text-[10px]">
                  <TagIcon className="h-2.5 w-2.5" /> {t}
                </Badge>
              ))}
            </div>
          </Section>
        )}

        {/* Email history */}
        <Section
          title="Emails échangés"
          trailing={
            primaryEmail && (
              <Link to="/inbox" className="text-xs text-primary hover:underline">
                Voir dans l'inbox →
              </Link>
            )
          }
        >
          {history.length === 0 ? (
            <div className="text-xs italic text-muted-foreground">Aucun email récent</div>
          ) : (
            <ul className="space-y-1">
              {history.map((e) => (
                <li key={e.id} className="flex items-baseline gap-2 text-xs">
                  <span className="truncate flex-1">{e.subject || "(sans objet)"}</span>
                  <span className="shrink-0 text-muted-foreground">{e.received_at ? relativeTime(e.received_at) : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Tasks */}
        <Section title="Tâches liées">
          {tasks.length === 0 ? (
            <div className="text-xs italic text-muted-foreground">Aucune tâche liée</div>
          ) : (
            <ul className="space-y-1">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-baseline gap-2 text-xs">
                  <span className={cn("h-2 w-2 rounded-full", t.status === "done" ? "bg-emerald-500" : "bg-amber-500")} />
                  <span className="truncate flex-1">{t.title}</span>
                  {t.due_date && <span className="shrink-0 text-muted-foreground">{relativeTime(t.due_date)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Notes */}
        <Section title="Notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== (contact.notes ?? "")) onSave({ notes });
            }}
            placeholder="Notes libres…"
            className="min-h-[100px] text-xs"
          />
        </Section>
      </div>

      {/* Compose dialog */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Envoyer un email à {fullName(contact)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <label className="mb-1 block text-xs font-medium">Depuis le compte</label>
              <Select value={composeFrom} onValueChange={setComposeFrom}>
                <SelectTrigger><SelectValue placeholder="Choisir un compte" /></SelectTrigger>
                <SelectContent>
                  {accounts.length === 0 ? (
                    <SelectItem value="none" disabled>Aucun compte</SelectItem>
                  ) : (
                    accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: a.color ?? "#64748b" }} />
                          {a.name}
                        </span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="text-xs text-muted-foreground">Destination : {primaryEmail}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComposeOpen(false)}>Annuler</Button>
            <Button onClick={sendEmail}><Send className="mr-1 h-3.5 w-3.5" /> Ouvrir le mail</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({
  title,
  children,
  trailing,
}: {
  title: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {trailing}
      </div>
      {children}
    </div>
  );
}

// =============== MERGE DIALOG ===============

type FieldKey = "first_name" | "last_name" | "organization" | "role" | "avatar_url" | "notes";

const SCALAR_FIELDS: { key: FieldKey; label: string }[] = [
  { key: "first_name", label: "Prénom" },
  { key: "last_name", label: "Nom" },
  { key: "organization", label: "Organisation" },
  { key: "role", label: "Rôle" },
  { key: "avatar_url", label: "Avatar" },
  { key: "notes", label: "Notes" },
];

function MergeDialog({
  a,
  b,
  onClose,
  onMerged,
}: {
  a: Contact;
  b: Contact;
  onClose: () => void;
  onMerged: (merged: Contact, removedId: string) => void;
}) {
  // For each scalar field, keep "a" or "b"; arrays are unioned.
  const initial: Record<FieldKey, "a" | "b"> = {} as Record<FieldKey, "a" | "b">;
  SCALAR_FIELDS.forEach((f) => {
    initial[f.key] = (a[f.key] ?? "") ? "a" : "b";
  });
  const [choices, setChoices] = useState(initial);
  const [keepId, setKeepId] = useState<"a" | "b">("a");

  const merge = () => {
    const base = keepId === "a" ? a : b;
    const updates: Partial<Contact> = { id: base.id };
    SCALAR_FIELDS.forEach((f) => {
      const src = choices[f.key] === "a" ? a : b;
      (updates as Record<string, unknown>)[f.key] = src[f.key] ?? null;
    });
    // Union arrays
    updates.email = Array.from(new Set([...(a.email ?? []), ...(b.email ?? [])]));
    updates.phone = Array.from(new Set([...(a.phone ?? []), ...(b.phone ?? [])]));
    updates.tags = Array.from(new Set([...(a.tags ?? []), ...(b.tags ?? [])]));
    updates.sources = Array.from(new Set([...(a.sources ?? []), ...(b.sources ?? [])]));
    const removedId = keepId === "a" ? b.id : a.id;
    onMerged(updates as Contact, removedId);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Merge className="h-4 w-4" /> Fusionner les contacts
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-md border p-2">
            <button
              onClick={() => setKeepId("a")}
              className={cn(
                "rounded p-2 text-left text-xs transition-colors",
                keepId === "a" ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted",
              )}
            >
              <div className="flex items-center gap-1 font-semibold">
                {keepId === "a" && <Check className="h-3 w-3 text-primary" />} Garder : {fullName(a)}
              </div>
              <div className="text-muted-foreground">{a.email?.[0] ?? "—"}</div>
            </button>
            <button
              onClick={() => setKeepId("b")}
              className={cn(
                "rounded p-2 text-left text-xs transition-colors",
                keepId === "b" ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted",
              )}
            >
              <div className="flex items-center gap-1 font-semibold">
                {keepId === "b" && <Check className="h-3 w-3 text-primary" />} Garder : {fullName(b)}
              </div>
              <div className="text-muted-foreground">{b.email?.[0] ?? "—"}</div>
            </button>
          </div>

          <div className="rounded-md border">
            <div className="grid grid-cols-[120px_1fr_1fr] gap-2 border-b bg-muted/50 px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
              <span>Champ</span>
              <span>Source A</span>
              <span>Source B</span>
            </div>
            {SCALAR_FIELDS.map((f) => {
              const va = (a[f.key] ?? "") as string;
              const vb = (b[f.key] ?? "") as string;
              const conflict = va !== vb && va && vb;
              return (
                <div
                  key={f.key}
                  className={cn(
                    "grid grid-cols-[120px_1fr_1fr] items-center gap-2 border-b px-3 py-2 text-xs last:border-0",
                    conflict && "bg-amber-500/5",
                  )}
                >
                  <span className="font-medium text-muted-foreground">{f.label}</span>
                  <button
                    onClick={() => setChoices((p) => ({ ...p, [f.key]: "a" }))}
                    className={cn(
                      "truncate rounded px-2 py-1 text-left transition-colors",
                      choices[f.key] === "a" ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted",
                    )}
                  >
                    {va || <span className="italic text-muted-foreground">—</span>}
                  </button>
                  <button
                    onClick={() => setChoices((p) => ({ ...p, [f.key]: "b" }))}
                    className={cn(
                      "truncate rounded px-2 py-1 text-left transition-colors",
                      choices[f.key] === "b" ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted",
                    )}
                  >
                    {vb || <span className="italic text-muted-foreground">—</span>}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
            Les emails, téléphones, tags et sources des deux contacts seront automatiquement fusionnés.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}><X className="mr-1 h-3.5 w-3.5" /> Annuler</Button>
          <Button onClick={merge}><Merge className="mr-1 h-3.5 w-3.5" /> Fusionner</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
