import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Mail, CheckSquare, Users, Calendar as CalendarIcon, FileText,
  Paperclip, Video, AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

type SearchParams = { q?: string };

export const Route = createFileRoute("/_authenticated/search")({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    q: typeof s.q === "string" ? s.q : "",
  }),
  component: SearchPage,
});

type Tab = "all" | "emails" | "tasks" | "contacts" | "meetings" | "documents";
type Sort = "relevance" | "date" | "source";

type Results = {
  emails: any[];
  tasks: any[];
  contacts: any[];
  meetings: any[];
  documents: any[];
};

const EMPTY: Results = { emails: [], tasks: [], contacts: [], meetings: [], documents: [] };

function highlight(text: string | null | undefined, q: string) {
  if (!text) return null;
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-amber-200 px-0.5 text-foreground dark:bg-amber-500/40">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function originBadge(tag?: string | null) {
  const map: Record<string, { label: string; emoji: string; cls: string }> = {
    chu: { label: "CHU", emoji: "🏥", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
    univ: { label: "Univ", emoji: "🎓", cls: "bg-purple-500/15 text-purple-700 dark:text-purple-300" },
    gmail: { label: "Gmail", emoji: "📧", cls: "bg-red-500/15 text-red-700 dark:text-red-300" },
    outlook: { label: "Outlook", emoji: "💼", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
    imap: { label: "IMAP", emoji: "🔧", cls: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  };
  const t = (tag ?? "").toLowerCase();
  const m = map[t] ?? { label: tag ?? "Mail", emoji: "✉️", cls: "bg-muted text-muted-foreground" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${m.cls}`}>
      <span>{m.emoji}</span>{m.label}
    </span>
  );
}

function priorityBadge(p?: string | null) {
  const map: Record<string, string> = {
    urgent: "🔴 Urgent", high: "🟠 Haute", medium: "🟡 Moyenne", low: "🟢 Basse",
  };
  return <Badge variant="secondary" className="text-[10px]">{map[p ?? "medium"] ?? p}</Badge>;
}

function SearchPage() {
  const { q = "" } = Route.useSearch();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<Sort>("relevance");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Results>(EMPTY);

  const run = async () => {
    if (!q || q.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("Non authentifié");
      const esc = q.replace(/[%,]/g, " ");
      const [emails, tasks, contacts, meetings, documents] = await Promise.all([
        supabase.from("emails")
          .select("id, subject, from_address, from_name, body_text, received_at, origin_tag, has_attachment, account_id, is_sensitive")
          .eq("user_id", userId).is("deleted_at", null)
          .or(`subject.ilike.%${esc}%,from_address.ilike.%${esc}%,from_name.ilike.%${esc}%,body_text.ilike.%${esc}%`)
          .order("received_at", { ascending: false }).limit(20),
        supabase.from("tasks")
          .select("id, title, description, status, priority, due_date, tags")
          .eq("user_id", userId)
          .or(`title.ilike.%${esc}%,description.ilike.%${esc}%`)
          .order("updated_at", { ascending: false }).limit(10),
        supabase.from("contacts")
          .select("id, first_name, last_name, organization, email, phone, sources")
          .eq("user_id", userId)
          .or(`first_name.ilike.%${esc}%,last_name.ilike.%${esc}%,organization.ilike.%${esc}%`)
          .order("last_name", { ascending: true }).limit(10),
        supabase.from("meetings")
          .select("id, title, description, start_at, end_at, location, status, is_online, online_provider")
          .eq("user_id", userId)
          .or(`title.ilike.%${esc}%,description.ilike.%${esc}%,location.ilike.%${esc}%`)
          .order("start_at", { ascending: false }).limit(10),
        supabase.from("documents")
          .select("id, filename, description, ai_summary, mime_type, file_size, source_type, created_at")
          .eq("user_id", userId)
          .or(`filename.ilike.%${esc}%,description.ilike.%${esc}%,ai_summary.ilike.%${esc}%`)
          .order("created_at", { ascending: false }).limit(10),
      ]);
      setResults({
        emails: emails.data ?? [],
        tasks: tasks.data ?? [],
        contacts: contacts.data ?? [],
        meetings: meetings.data ?? [],
        documents: documents.data ?? [],
      });
    } catch (e: any) {
      setError(e?.message ?? "Erreur de recherche");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { run(); /* eslint-disable-next-line */ }, [q]);

  const counts = {
    emails: results.emails.length,
    tasks: results.tasks.length,
    contacts: results.contacts.length,
    meetings: results.meetings.length,
    documents: results.documents.length,
  };
  const total = counts.emails + counts.tasks + counts.contacts + counts.meetings + counts.documents;

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "all", label: "Tout", count: total },
    { id: "emails", label: "Emails", count: counts.emails },
    { id: "tasks", label: "Tâches", count: counts.tasks },
    { id: "contacts", label: "Contacts", count: counts.contacts },
    { id: "meetings", label: "Réunions", count: counts.meetings },
    { id: "documents", label: "Documents", count: counts.documents },
  ];

  const showSection = (id: Exclude<Tab, "all">) => tab === "all" || tab === id;

  const sortedEmails = useMemo(() => {
    const arr = [...results.emails];
    if (sort === "date") arr.sort((a, b) => +new Date(b.received_at ?? 0) - +new Date(a.received_at ?? 0));
    return arr;
  }, [results.emails, sort]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Résultats pour <span className="text-primary">"{q}"</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Recherche…" : `${total} résultat${total > 1 ? "s" : ""} trouvé${total > 1 ? "s" : ""}`}
          </p>
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="relevance">Pertinence</SelectItem>
            <SelectItem value="date">Date récente</SelectItem>
            <SelectItem value="source">Source</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {tabs.map((t) => {
          const disabled = t.count === 0 && t.id !== "all";
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => !disabled && setTab(t.id)}
              disabled={disabled}
              className={`relative px-3 py-2 text-sm font-medium transition-colors ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              {t.label} ({t.count})
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 bg-primary" />}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={run}>Réessayer</Button>
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      )}

      {!loading && !error && total === 0 && (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          Aucun résultat pour "{q}" — essayez avec d'autres mots-clés
        </div>
      )}

      {!loading && !error && total > 0 && (
        <div className="space-y-6">
          {showSection("emails") && counts.emails > 0 && (
            <Section icon={<Mail className="h-4 w-4" />} title="Emails" count={counts.emails}>
              {sortedEmails.map((e) => (
                <Link
                  key={e.id}
                  to="/inbox"
                  search={{ open: e.id } as any}
                  className="block rounded-md border bg-card p-3 hover:bg-accent"
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {originBadge(e.origin_tag)}
                    <span className="font-medium text-foreground">{e.from_name || e.from_address}</span>
                    {e.has_attachment && <Paperclip className="h-3 w-3" />}
                    {e.is_sensitive && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                    <span className="ml-auto">
                      {e.received_at && formatDistanceToNow(new Date(e.received_at), { addSuffix: true, locale: fr })}
                    </span>
                  </div>
                  <div className="mt-1 font-medium">
                    {e.is_sensitive
                      ? <span className="italic text-muted-foreground">{(e.subject ?? "").split(" ").slice(0, 3).join(" ")}…</span>
                      : highlight(e.subject, q)}
                  </div>
                  {!e.is_sensitive && e.body_text && (
                    <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {highlight(e.body_text.slice(0, 150), q)}
                    </div>
                  )}
                </Link>
              ))}
            </Section>
          )}

          {showSection("tasks") && counts.tasks > 0 && (
            <Section icon={<CheckSquare className="h-4 w-4" />} title="Tâches" count={counts.tasks}>
              {results.tasks.map((t) => {
                const overdue = t.due_date && new Date(t.due_date) < new Date();
                return (
                  <Link key={t.id} to="/tasks" className="block rounded-md border bg-card p-3 hover:bg-accent">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 font-medium">{highlight(t.title, q)}</div>
                      {priorityBadge(t.priority)}
                      <Badge variant="outline" className="text-[10px]">{t.status}</Badge>
                    </div>
                    {t.description && (
                      <div className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                        {highlight(t.description.slice(0, 100), q)}
                      </div>
                    )}
                    {t.due_date && (
                      <div className={`mt-1 text-xs ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
                        Échéance : {new Date(t.due_date).toLocaleDateString("fr-FR")}
                      </div>
                    )}
                  </Link>
                );
              })}
            </Section>
          )}

          {showSection("contacts") && counts.contacts > 0 && (
            <Section icon={<Users className="h-4 w-4" />} title="Contacts" count={counts.contacts}>
              {results.contacts.map((c) => {
                const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || (c.email?.[0] ?? "—");
                const initials = name.split(" ").map((x: string) => x[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <Link key={c.id} to="/contacts" className="flex items-center gap-3 rounded-md border bg-card p-3 hover:bg-accent">
                    <Avatar className="h-9 w-9"><AvatarFallback>{initials}</AvatarFallback></Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{highlight(name, q)}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {c.organization && <>{highlight(c.organization, q)} · </>}{c.email?.[0]}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {(c.sources ?? []).slice(0, 3).map((s: string) => (
                        <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                      ))}
                    </div>
                  </Link>
                );
              })}
            </Section>
          )}

          {showSection("meetings") && counts.meetings > 0 && (
            <Section icon={<CalendarIcon className="h-4 w-4" />} title="Réunions" count={counts.meetings}>
              {results.meetings.map((m) => (
                <Link key={m.id} to="/meetings" className="block rounded-md border bg-card p-3 hover:bg-accent">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 font-medium">{highlight(m.title, q)}</div>
                    {m.is_online && <Video className="h-4 w-4 text-muted-foreground" />}
                    <Badge variant="outline" className="text-[10px]">{m.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {m.start_at && new Date(m.start_at).toLocaleString("fr-FR")}
                    {m.location && <> · {highlight(m.location, q)}</>}
                  </div>
                </Link>
              ))}
            </Section>
          )}

          {showSection("documents") && counts.documents > 0 && (
            <Section icon={<FileText className="h-4 w-4" />} title="Documents" count={counts.documents}>
              {results.documents.map((d) => (
                <Link key={d.id} to="/documents" className="flex items-center gap-3 rounded-md border bg-card p-3 hover:bg-accent">
                  <FileText className="h-6 w-6 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{highlight(d.filename, q)}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.source_type} · {d.file_size ? `${Math.round(d.file_size / 1024)} Ko` : ""}
                      {d.created_at && <> · {new Date(d.created_at).toLocaleDateString("fr-FR")}</>}
                    </div>
                  </div>
                </Link>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        {icon} {title} <span className="text-xs">({count})</span>
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
