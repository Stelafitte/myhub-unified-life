import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Inbox as InboxIcon,
  Search,
  Star,
  Paperclip,
  Archive,
  Trash2,
  Reply,
  ReplyAll,
  Forward,
  Mail,
  MailOpen,
  Plus,
  Zap,
  Tag,
  Circle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input as DateInput } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/relative-time";
import { cacheEmails, loadCachedEmails, type CachedEmail } from "@/lib/inbox-cache";

type Account = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  icon: string | null;
};

type Email = CachedEmail;

type Filter = "all" | "unread" | "attachments" | "starred" | `account:${string}`;

export const Route = createFileRoute("/_authenticated/inbox")({
  component: InboxPage,
});

function InboxPage() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [usingCache, setUsingCache] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  // Online/offline awareness
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Load data: cache first, then network
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const cached = await loadCachedEmails();
      if (!cancelled && cached.length > 0) {
        setEmails(cached);
        setUsingCache(true);
      }

      const [{ data: accs }, { data: ems, error }] = await Promise.all([
        supabase.from("accounts").select("id,name,type,color,icon").order("created_at"),
        supabase
          .from("emails")
          .select("*")
          .eq("is_archived", false)
          .order("received_at", { ascending: false })
          .limit(1000),
      ]);

      if (cancelled) return;
      if (accs) setAccounts(accs as Account[]);
      if (error) {
        if (cached.length === 0) toast.error("Hors-ligne : aucun cache disponible");
      } else if (ems) {
        setEmails(ems as Email[]);
        setUsingCache(false);
        cacheEmails(ems as Email[]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const accountById = useMemo(() => {
    const m = new Map<string, Account>();
    accounts.forEach((a) => m.set(a.id, a));
    return m;
  }, [accounts]);

  const counts = useMemo(() => {
    const unread = emails.filter((e) => !e.is_read).length;
    const attachments = emails.filter((e) => e.has_attachment).length;
    const starred = emails.filter((e) => e.is_starred).length;
    const byAccount = new Map<string, number>();
    emails.forEach((e) => byAccount.set(e.account_id, (byAccount.get(e.account_id) ?? 0) + 1));
    return { all: emails.length, unread, attachments, starred, byAccount };
  }, [emails]);

  const filtered = useMemo(() => {
    let list = emails;
    if (filter === "unread") list = list.filter((e) => !e.is_read);
    else if (filter === "attachments") list = list.filter((e) => e.has_attachment);
    else if (filter === "starred") list = list.filter((e) => e.is_starred);
    else if (filter.startsWith("account:")) {
      const id = filter.slice(8);
      list = list.filter((e) => e.account_id === id);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (e) =>
          (e.subject ?? "").toLowerCase().includes(q) ||
          (e.from_address ?? "").toLowerCase().includes(q) ||
          (e.from_name ?? "").toLowerCase().includes(q) ||
          (e.body_text ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [emails, filter, query]);

  const selected = useMemo(
    () => emails.find((e) => e.id === selectedId) ?? null,
    [emails, selectedId],
  );

  // Mutations (optimistic)
  const patch = async (id: string, updates: Partial<Email>) => {
    setEmails((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
    const { error } = await supabase.from("emails").update(updates).eq("id", id);
    if (error) toast.error(error.message);
  };

  const toggleRead = (e: Email) => patch(e.id, { is_read: !e.is_read });
  const toggleStar = (e: Email) => patch(e.id, { is_starred: !e.is_starred });
  const archive = async (e: Email) => {
    setEmails((prev) => prev.filter((x) => x.id !== e.id));
    if (selectedId === e.id) setSelectedId(null);
    const { error } = await supabase.from("emails").update({ is_archived: true }).eq("id", e.id);
    if (error) toast.error(error.message);
    else toast.success("Email archivé");
  };
  const remove = async (e: Email) => {
    setEmails((prev) => prev.filter((x) => x.id !== e.id));
    if (selectedId === e.id) setSelectedId(null);
    const { error } = await supabase.from("emails").delete().eq("id", e.id);
    if (error) toast.error(error.message);
    else toast.success("Email supprimé");
  };

  const openEmail = (e: Email) => {
    setSelectedId(e.id);
    if (!e.is_read) patch(e.id, { is_read: true });
  };

  return (
    <div className="-mx-4 -my-4 flex h-[calc(100vh-4rem)] overflow-hidden md:-mx-6">
      {/* LEFT — filters */}
      <aside className="hidden w-[280px] shrink-0 flex-col border-r bg-card md:flex">
        <div className="border-b p-4">
          <div className="mb-3 flex items-center gap-2">
            <InboxIcon className="h-5 w-5 text-primary" />
            <h1 className="text-sm font-semibold">Boîte unifiée</h1>
            {offline && (
              <Badge variant="secondary" className="ml-auto gap-1 text-[10px]">
                <Zap className="h-3 w-3" /> Cache local
              </Badge>
            )}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Rechercher…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2 text-sm">
          <FilterRow label="Tous les mails" icon={<Mail className="h-4 w-4" />} count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
          <FilterRow label="Non lus" icon={<Circle className="h-4 w-4 fill-current" />} count={counts.unread} active={filter === "unread"} onClick={() => setFilter("unread")} />
          <FilterRow label="Pièces jointes" icon={<Paperclip className="h-4 w-4" />} count={counts.attachments} active={filter === "attachments"} onClick={() => setFilter("attachments")} />
          <FilterRow label="Suivis" icon={<Star className="h-4 w-4" />} count={counts.starred} active={filter === "starred"} onClick={() => setFilter("starred")} />

          <div className="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Comptes
          </div>
          {accounts.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Aucun compte configuré.</div>
          )}
          {accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => setFilter(`account:${a.id}`)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors",
                filter === `account:${a.id}` ? "bg-accent" : "hover:bg-accent/50",
              )}
            >
              <span
                className="flex h-5 w-5 items-center justify-center rounded text-xs"
                style={{ background: a.color ?? "#64748b", color: "#fff" }}
              >
                {a.icon ?? "✉️"}
              </span>
              <span className="flex-1 truncate text-sm">{a.name}</span>
              <span className="text-[11px] text-muted-foreground">{counts.byAccount.get(a.id) ?? 0}</span>
            </button>
          ))}
        </nav>

        {usingCache && (
          <div className="border-t bg-amber-500/10 px-4 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            <Zap className="mr-1 inline h-3 w-3" /> Données chargées depuis le cache local
          </div>
        )}
      </aside>

      {/* CENTER — list */}
      <section className="flex min-w-0 flex-1 flex-col border-r">
        <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
          <span>{filtered.length} email{filtered.length > 1 ? "s" : ""}</span>
        </div>
        <ul className="flex-1 divide-y overflow-y-auto">
          {filtered.length === 0 && (
            <li className="p-10 text-center text-sm text-muted-foreground">
              {emails.length === 0 ? "Aucun email — configurez un compte dans Paramètres." : "Aucun résultat."}
            </li>
          )}
          {filtered.map((e) => {
            const acc = accountById.get(e.account_id);
            const isSel = e.id === selectedId;
            return (
              <li
                key={e.id}
                onClick={() => openEmail(e)}
                className={cn(
                  "group relative cursor-pointer px-3 py-2.5 transition-colors",
                  isSel ? "bg-accent" : "hover:bg-accent/50",
                  !e.is_read && "bg-primary/[0.03]",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: acc?.color ?? "#64748b" }}
                    title={acc?.name}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className={cn("truncate text-sm", !e.is_read && "font-semibold")}>
                        {e.from_name || e.from_address || "Inconnu"}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                        {relativeTime(e.received_at)}
                      </span>
                    </div>
                    <div className={cn("truncate text-sm", !e.is_read ? "font-semibold" : "text-foreground/80")}>
                      {e.subject || "(sans objet)"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {(e.body_text ?? "").replace(/\s+/g, " ").slice(0, 120)}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                      {e.is_starred && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                      {e.has_attachment && <Paperclip className="h-3 w-3" />}
                      {(e.labels ?? []).slice(0, 2).map((l) => (
                        <span key={l} className="flex items-center gap-0.5 text-[10px]">
                          <Tag className="h-2.5 w-2.5" /> {l}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* hover actions */}
                <div className="absolute right-2 top-2 hidden gap-1 rounded-md border bg-background p-0.5 shadow-sm group-hover:flex">
                  <IconBtn label={e.is_read ? "Marquer non lu" : "Marquer lu"} onClick={(ev) => { ev.stopPropagation(); toggleRead(e); }}>
                    {e.is_read ? <Mail className="h-3.5 w-3.5" /> : <MailOpen className="h-3.5 w-3.5" />}
                  </IconBtn>
                  <IconBtn label="Étoiler" onClick={(ev) => { ev.stopPropagation(); toggleStar(e); }}>
                    <Star className={cn("h-3.5 w-3.5", e.is_starred && "fill-amber-400 text-amber-400")} />
                  </IconBtn>
                  <IconBtn label="Archiver" onClick={(ev) => { ev.stopPropagation(); archive(e); }}>
                    <Archive className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn label="Créer une tâche" onClick={(ev) => { ev.stopPropagation(); setSelectedId(e.id); setTaskOpen(true); }}>
                    <Plus className="h-3.5 w-3.5" />
                  </IconBtn>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* RIGHT — reader */}
      <aside className="hidden w-[420px] shrink-0 flex-col bg-card lg:flex">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            Sélectionnez un email pour le lire
          </div>
        ) : (
          <Reader
            email={selected}
            account={accountById.get(selected.account_id)}
            onStar={() => toggleStar(selected)}
            onArchive={() => archive(selected)}
            onDelete={() => remove(selected)}
            onCreateTask={() => setTaskOpen(true)}
          />
        )}
      </aside>

      {selected && (
        <CreateTaskDialog
          open={taskOpen}
          onOpenChange={setTaskOpen}
          email={selected}
          userId={user?.id ?? ""}
        />
      )}
    </div>
  );
}

function FilterRow({ label, icon, count, active, onClick }: { label: string; icon: React.ReactNode; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors",
        active ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/50",
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-sm">{label}</span>
      <span className="text-[11px] text-muted-foreground">{count}</span>
    </button>
  );
}

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      title={label}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

function Reader({
  email,
  account,
  onStar,
  onArchive,
  onDelete,
  onCreateTask,
}: {
  email: Email;
  account?: Account;
  onStar: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onCreateTask: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b p-4">
        <div className="mb-2 flex items-center gap-2">
          {account && (
            <Badge style={{ background: account.color ?? "#64748b", color: "#fff" }} className="border-0">
              {account.icon} {account.name}
            </Badge>
          )}
          <button onClick={onStar} className="ml-auto text-muted-foreground hover:text-amber-400">
            <Star className={cn("h-4 w-4", email.is_starred && "fill-amber-400 text-amber-400")} />
          </button>
        </div>
        <h2 className="text-base font-semibold">{email.subject || "(sans objet)"}</h2>
        <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          <div><span className="font-medium text-foreground">De :</span> {email.from_name ? `${email.from_name} <${email.from_address}>` : email.from_address}</div>
          <div><span className="font-medium text-foreground">À :</span> {email.to_address}</div>
          <div><span className="font-medium text-foreground">Date :</span> {email.received_at ? new Date(email.received_at).toLocaleString("fr-FR") : ""}</div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          <Button size="sm" variant="outline" className="h-7 gap-1"><Reply className="h-3 w-3" /> Répondre</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1"><ReplyAll className="h-3 w-3" /> Tous</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1"><Forward className="h-3 w-3" /> Transférer</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={onArchive}><Archive className="h-3 w-3" /> Archiver</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-destructive" onClick={onDelete}><Trash2 className="h-3 w-3" /> Suppr.</Button>
        </div>
        <Button size="sm" className="mt-2 w-full gap-1" onClick={onCreateTask}>
          <Plus className="h-3.5 w-3.5" /> Créer une tâche depuis ce mail
        </Button>
      </header>

      {email.has_attachment && (
        <div className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <Paperclip className="mr-1 inline h-3 w-3" /> Cet email contient des pièces jointes (téléchargement disponible après synchronisation complète).
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 text-sm">
        {email.body_html ? (
          <div
            className="prose prose-sm max-w-none dark:prose-invert"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: email.body_html }}
          />
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{email.body_text ?? "(vide)"}</pre>
        )}
      </div>
    </div>
  );
}

function CreateTaskDialog({
  open,
  onOpenChange,
  email,
  userId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  email: Email;
  userId: string;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [comments, setComments] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [dueDate, setDueDate] = useState("");
  const [createEvent, setCreateEvent] = useState(false);
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(email.subject ?? "");
      const extract = (email.body_text ?? "").replace(/\s+/g, " ").slice(0, 280);
      const from = email.from_name || email.from_address || "";
      setDescription(`Depuis : ${from}\n\n${extract}${extract.length === 280 ? "…" : ""}`);
      setComments("");
      setPriority("medium");
      setDueDate("");
      setCreateEvent(false);
      setEventStart("");
      setEventEnd("");
      setEventTitle("");
    }
  }, [open, email]);

  const runAi = async () => {
    setAnalyzing(true);
    try {
      const { analyzeEmailForTask } = await import("@/lib/api/email-analysis.functions");
      const res = await analyzeEmailForTask({
        data: {
          subject: email.subject,
          from: email.from_name || email.from_address,
          body: email.body_text ?? email.body_html ?? "",
          receivedAt: email.received_at,
        },
      });
      setTitle(res.title);
      setDescription(res.summary);
      setComments(res.comments);
      setPriority(res.priority);
      if (res.due_date) setDueDate(res.due_date.slice(0, 10));
      if (res.has_event && res.event_start) {
        setCreateEvent(true);
        setEventStart(res.event_start.slice(0, 16));
        setEventEnd((res.event_end ?? res.event_start).slice(0, 16));
        setEventTitle(res.event_title ?? res.title);
      }
      toast.success("Analyse IA terminée");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur IA");
    } finally {
      setAnalyzing(false);
    }
  };

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Titre requis");
      return;
    }
    setSaving(true);
    try {
      let calendarEventId: string | null = null;
      if (createEvent && eventStart) {
        const { data: ev, error: evErr } = await supabase.from("calendar_events").insert({
          user_id: userId,
          title: eventTitle || title.trim(),
          description: `Créé depuis l'email : ${email.subject ?? ""}`,
          start_at: new Date(eventStart).toISOString(),
          end_at: new Date(eventEnd || eventStart).toISOString(),
          color: "#6366f1",
        }).select("id").single();
        if (evErr) throw evErr;
        calendarEventId = ev.id;
      }

      const dueIso = dueDate ? new Date(dueDate).toISOString() : null;
      const attachments = email.has_attachment
        ? [{ name: `Pièces jointes de "${email.subject ?? "email"}"`, mime: null, size: null, url: null }]
        : [];

      const { error } = await supabase.from("tasks").insert({
        user_id: userId,
        title: title.trim(),
        description,
        comments: comments || null,
        priority,
        due_date: dueIso,
        gantt_start: dueIso,
        gantt_end: dueIso,
        source_app: "myhubpro",
        source_email_id: email.id,
        calendar_event_id: calendarEventId,
        attachments,
        status: "todo",
      });
      if (error) throw error;
      toast.success(calendarEventId ? "Tâche + événement créés" : "Tâche créée");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Créer une tâche depuis ce mail</DialogTitle>
        </DialogHeader>
        <Button
          type="button"
          onClick={runAi}
          disabled={analyzing}
          className="w-full gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-700 hover:to-fuchsia-700"
        >
          <Zap className="h-4 w-4" />
          {analyzing ? "Analyse en cours…" : "✨ Pré-remplir avec l'IA"}
        </Button>
        <div className="space-y-3">
          <div>
            <Label htmlFor="t-title">Titre</Label>
            <Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="t-desc">Description</Label>
            <Textarea id="t-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="t-comments">Commentaires (texte libre)</Label>
            <Textarea
              id="t-comments"
              rows={3}
              placeholder="Notes, contexte, points d'attention…"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Priorité</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">🟢 Basse</SelectItem>
                  <SelectItem value="medium">🟡 Moyenne</SelectItem>
                  <SelectItem value="high">🟠 Haute</SelectItem>
                  <SelectItem value="urgent">🔴 Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="t-due">Échéance</Label>
              <DateInput id="t-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={createEvent}
                onChange={(e) => setCreateEvent(e.target.checked)}
                className="h-4 w-4"
              />
              <span>📅 Créer aussi un événement dans l'agenda</span>
            </label>
            {createEvent && (
              <div className="mt-2 space-y-2">
                <Input
                  placeholder="Titre de l'événement"
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Début</Label>
                    <Input type="datetime-local" value={eventStart} onChange={(e) => setEventStart(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Fin</Label>
                    <Input type="datetime-local" value={eventEnd} onChange={(e) => setEventEnd(e.target.value)} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            <div>🔗 Lien vers l'email source conservé (id : {email.id.slice(0, 8)}…)</div>
            {email.has_attachment && (
              <div className="flex items-center gap-1">
                <Paperclip className="h-3 w-3" /> Pièce(s) jointe(s) du mail rattachée(s) à la tâche
              </div>
            )}
            {dueDate && <div>📊 La tâche apparaîtra dans le rétroplanning (Gantt)</div>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Création…" : "Créer la tâche"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

