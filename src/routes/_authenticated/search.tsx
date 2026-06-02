import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Search as SearchIcon,
  Paperclip,
  Video,
  FileText,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SearchParams = { q: string };

export const Route = createFileRoute("/_authenticated/search")({
  validateSearch: (raw: Record<string, unknown>): SearchParams => ({
    q: typeof raw.q === "string" ? raw.q : "",
  }),
  component: SearchPage,
});

type Tab = "all" | "emails" | "tasks" | "contacts" | "meetings" | "documents";
type Sort = "relevance" | "recent" | "source";

type EmailRow = {
  id: string;
  subject: string | null;
  from_address: string | null;
  from_name: string | null;
  body_text: string | null;
  origin_tag: string | null;
  received_at: string | null;
  has_attachment: boolean;
  is_sensitive: boolean;
};
type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  updated_at: string;
};
type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  organization: string | null;
  email: string[] | null;
  avatar_url: string | null;
  sources: string[] | null;
};
type MeetingRow = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  status: string;
  is_online: boolean;
  online_provider: string | null;
};
type DocumentRow = {
  id: string;
  filename: string;
  original_filename: string;
  description: string | null;
  ai_summary: string | null;
  file_size: number;
  mime_type: string | null;
  source_type: string;
  created_at: string;
};

type ResultBundle = {
  emails: EmailRow[];
  tasks: TaskRow[];
  contacts: ContactRow[];
  meetings: MeetingRow[];
  documents: DocumentRow[];
};

const EMPTY: ResultBundle = {
  emails: [],
  tasks: [],
  contacts: [],
  meetings: [],
  documents: [],
};

function SearchPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate();
  const term = q.trim();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultBundle>(EMPTY);
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<Sort>("relevance");
  const [draft, setDraft] = useState(term);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { setDraft(term); }, [term]);

  useEffect(() => {
    if (term.length < 2) {
      setResults(EMPTY);
      setError(null);
      return;
    }
    let cancelled = false;
    const like = `%${term.replace(/[%_]/g, (m) => "\\" + m)}%`;
    setLoading(true);
    setError(null);

    Promise.all([
      supabase
        .from("emails")
        .select("id,subject,from_address,from_name,body_text,origin_tag,received_at,has_attachment,is_sensitive")
        .is("deleted_at", null)
        .or(
          `subject.ilike.${like},from_address.ilike.${like},from_name.ilike.${like},body_text.ilike.${like}`,
        )
        .order("received_at", { ascending: false })
        .limit(20),
      supabase
        .from("tasks")
        .select("id,title,description,priority,status,due_date,updated_at")
        .neq("status", "archived")
        .or(`title.ilike.${like},description.ilike.${like}`)
        .order("updated_at", { ascending: false })
        .limit(10),
      supabase
        .from("contacts")
        .select("id,first_name,last_name,organization,email,avatar_url,sources")
        .or(
          `first_name.ilike.${like},last_name.ilike.${like},organization.ilike.${like}`,
        )
        .order("last_name", { ascending: true })
        .limit(10),
      supabase
        .from("meetings")
        .select("id,title,description,location,start_at,end_at,status,is_online,online_provider")
        .or(`title.ilike.${like},description.ilike.${like},location.ilike.${like}`)
        .order("start_at", { ascending: false })
        .limit(10),
      supabase
        .from("documents")
        .select("id,filename,original_filename,description,ai_summary,file_size,mime_type,source_type,created_at")
        .or(`filename.ilike.${like},description.ilike.${like},ai_summary.ilike.${like}`)
        .order("created_at", { ascending: false })
        .limit(10),
    ])
      .then(([e, t, c, m, d]) => {
        if (cancelled) return;
        const firstErr =
          e.error?.message ?? t.error?.message ?? c.error?.message ?? m.error?.message ?? d.error?.message;
        if (firstErr) {
          setError(firstErr);
          setResults(EMPTY);
        } else {
          setResults({
            emails: (e.data ?? []) as EmailRow[],
            tasks: (t.data ?? []) as TaskRow[],
            contacts: (c.data ?? []) as ContactRow[],
            meetings: (m.data ?? []) as MeetingRow[],
            documents: (d.data ?? []) as DocumentRow[],
          });
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [term, reloadKey]);

  const counts = useMemo(() => ({
    all:
      results.emails.length +
      results.tasks.length +
      results.contacts.length +
      results.meetings.length +
      results.documents.length,
    emails: results.emails.length,
    tasks: results.tasks.length,
    contacts: results.contacts.length,
    meetings: results.meetings.length,
    documents: results.documents.length,
  }), [results]);

  const sorted = useMemo(() => applySort(results, sort), [results, sort]);

  const submitNew = () => {
    const v = draft.trim();
    if (v.length < 2) return;
    navigate({ to: "/search", search: { q: v } });
  };

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      {/* Inline search input — lets the user refine without going back to the header */}
      <form
        onSubmit={(e) => { e.preventDefault(); submitNew(); }}
        className="mb-4 flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 focus-within:bg-background"
        role="search"
      >
        <SearchIcon className="h-4 w-4 text-muted-foreground" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Rechercher dans MyHub Pro..."
          className="flex-1 bg-transparent text-sm outline-none"
          autoFocus
        />
      </form>

      {term.length < 2 ? (
        <p className="text-sm text-muted-foreground">
          Saisissez au moins 2 caractères pour lancer une recherche.
        </p>
      ) : (
        <>
          <header className="mb-4">
            <h1 className="text-xl font-semibold">
              Résultats pour <span className="text-primary">"{term}"</span>
            </h1>
          </header>

          {/* Tabs */}
          <div className="mb-3 flex flex-wrap items-center gap-1 border-b">
            {([
              ["all", "Tout"],
              ["emails", "Emails"],
              ["tasks", "Tâches"],
              ["contacts", "Contacts"],
              ["meetings", "Réunions"],
              ["documents", "Documents"],
            ] as Array<[Tab, string]>).map(([key, label]) => {
              const c = counts[key];
              const active = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    "relative -mb-px px-3 py-2 text-sm transition-colors border-b-2",
                    active
                      ? "border-primary text-foreground font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                    c === 0 && key !== "all" && "opacity-50",
                  )}
                >
                  {label} <span className="ml-1 text-xs">({c})</span>
                </button>
              );
            })}

            <div className="ml-auto flex items-center gap-2 pb-1">
              <label className="text-xs text-muted-foreground">Tri</label>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="h-8 rounded border border-border/60 bg-background px-2 text-xs"
              >
                <option value="relevance">Pertinence</option>
                <option value="recent">Le plus récent</option>
                <option value="source">Source</option>
              </select>
            </div>
          </div>

          {error ? (
            <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>Une erreur est survenue : {error}</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Réessayer
              </Button>
            </div>
          ) : loading ? (
            <ResultsSkeleton />
          ) : counts.all === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              Aucun résultat pour "<span className="font-medium">{term}</span>" — essayez avec
              d'autres mots-clés.
            </div>
          ) : (
            <Results bundle={sorted} term={term} tab={tab} />
          )}
        </>
      )}
    </div>
  );
}

function applySort(b: ResultBundle, sort: Sort): ResultBundle {
  if (sort === "relevance") return b;
  if (sort === "recent") {
    return {
      emails: [...b.emails].sort((a, x) => (x.received_at ?? "").localeCompare(a.received_at ?? "")),
      tasks: [...b.tasks].sort((a, x) => (x.updated_at ?? "").localeCompare(a.updated_at ?? "")),
      contacts: b.contacts,
      meetings: [...b.meetings].sort((a, x) => (x.start_at ?? "").localeCompare(a.start_at ?? "")),
      documents: [...b.documents].sort((a, x) => (x.created_at ?? "").localeCompare(a.created_at ?? "")),
    };
  }
  // source
  return {
    emails: [...b.emails].sort((a, x) => (a.origin_tag ?? "").localeCompare(x.origin_tag ?? "")),
    tasks: b.tasks,
    contacts: [...b.contacts].sort((a, x) => ((a.sources?.[0] ?? "")).localeCompare(x.sources?.[0] ?? "")),
    meetings: b.meetings,
    documents: [...b.documents].sort((a, x) => a.source_type.localeCompare(x.source_type)),
  };
}

function Results({ bundle, term, tab }: { bundle: ResultBundle; term: string; tab: Tab }) {
  const show = (t: Tab) => tab === "all" || tab === t;
  return (
    <div className="space-y-6">
      {show("emails") && bundle.emails.length > 0 && (
        <Section title={`Emails (${bundle.emails.length})`}>
          {bundle.emails.map((e) => <EmailResult key={e.id} email={e} term={term} />)}
        </Section>
      )}
      {show("tasks") && bundle.tasks.length > 0 && (
        <Section title={`Tâches (${bundle.tasks.length})`}>
          {bundle.tasks.map((t) => <TaskResult key={t.id} task={t} term={term} />)}
        </Section>
      )}
      {show("contacts") && bundle.contacts.length > 0 && (
        <Section title={`Contacts (${bundle.contacts.length})`}>
          {bundle.contacts.map((c) => <ContactResult key={c.id} contact={c} />)}
        </Section>
      )}
      {show("meetings") && bundle.meetings.length > 0 && (
        <Section title={`Réunions (${bundle.meetings.length})`}>
          {bundle.meetings.map((m) => <MeetingResult key={m.id} meeting={m} />)}
        </Section>
      )}
      {show("documents") && bundle.documents.length > 0 && (
        <Section title={`Documents (${bundle.documents.length})`}>
          {bundle.documents.map((d) => <DocumentResult key={d.id} doc={d} />)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function highlight(text: string, term: string): React.ReactNode {
  if (!term) return text;
  const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
  const parts = text.split(re);
  return parts.map((p, i) =>
    re.test(p) ? <mark key={i} className="rounded bg-yellow-200/70 px-0.5 dark:bg-yellow-500/40">{p}</mark> : <span key={i}>{p}</span>,
  );
}

function relativeDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const day = 86400000;
  if (diff < day) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diff < 7 * day) return `Il y a ${Math.floor(diff / day)}j`;
  return d.toLocaleDateString();
}

function ResultCard({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="block w-full rounded-md border border-border/50 bg-card p-3 text-left transition-colors hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {children}
    </button>
  );
}

const ORIGIN_COLORS: Record<string, string> = {
  chu: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  univ: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  gmail: "bg-red-500/15 text-red-700 dark:text-red-300",
  outlook: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  imap: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
};

function EmailResult({ email, term }: { email: EmailRow; term: string }) {
  const navigate = useNavigate();
  const sender = email.from_name || email.from_address || "Inconnu";
  const subject = email.subject ?? "(sans objet)";
  const sensitive = email.is_sensitive;
  const maskedSubject = sensitive ? `${subject.slice(0, 3)}••• (sensible)` : subject;
  const body = email.body_text ?? "";
  const idx = body.toLowerCase().indexOf(term.toLowerCase());
  const start = Math.max(0, idx - 40);
  const excerpt = idx >= 0 ? body.slice(start, start + 180) : body.slice(0, 180);
  const origin = email.origin_tag ?? "imap";

  return (
    <ResultCard onClick={() => navigate({ to: "/inbox" })}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{sender}</span>
            <Badge variant="secondary" className={cn("h-5 px-1.5 text-[10px] uppercase", ORIGIN_COLORS[origin])}>
              {origin}
            </Badge>
            {email.has_attachment && <Paperclip className="h-3 w-3" />}
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold">
            {highlight(maskedSubject, term)}
          </div>
          {!sensitive && excerpt && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {highlight(excerpt, term)}
            </p>
          )}
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">{relativeDate(email.received_at)}</span>
      </div>
    </ResultCard>
  );
}

const PRIORITY: Record<string, { label: string; icon: string; className: string }> = {
  urgent: { label: "Urgent", icon: "🔴", className: "bg-red-500/15 text-red-700 dark:text-red-300" },
  high: { label: "Haute", icon: "🟠", className: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  medium: { label: "Moyenne", icon: "🟡", className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300" },
  low: { label: "Basse", icon: "🟢", className: "bg-green-500/15 text-green-700 dark:text-green-300" },
};

function TaskResult({ task, term }: { task: TaskRow; term: string }) {
  const navigate = useNavigate();
  const p = PRIORITY[task.priority] ?? PRIORITY.medium;
  return (
    <ResultCard onClick={() => navigate({ to: "/tasks" })}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{highlight(task.title, term)}</div>
          {task.description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {highlight(task.description, term)}
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-1.5">
            <Badge variant="secondary" className={cn("h-5 px-1.5 text-[10px]", p.className)}>
              {p.icon} {p.label}
            </Badge>
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] capitalize">{task.status}</Badge>
            {task.due_date && (
              <span className="text-[11px] text-muted-foreground">
                Échéance {new Date(task.due_date).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </div>
    </ResultCard>
  );
}

function ContactResult({ contact }: { contact: ContactRow }) {
  const navigate = useNavigate();
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Sans nom";
  const initials = ((contact.first_name?.[0] ?? "") + (contact.last_name?.[0] ?? "")).toUpperCase() || "?";
  const primaryEmail = contact.email?.[0];
  return (
    <ResultCard onClick={() => navigate({ to: "/contacts" })}>
      <div className="flex items-center gap-3">
        <Avatar className="h-9 w-9">
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {contact.organization ? `${contact.organization} · ` : ""}{primaryEmail ?? ""}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {(contact.sources ?? []).slice(0, 3).map((s) => (
            <Badge key={s} variant="secondary" className="h-5 px-1.5 text-[10px] capitalize">{s}</Badge>
          ))}
        </div>
      </div>
    </ResultCard>
  );
}

const MEETING_STATUS: Record<string, string> = {
  scheduled: "Planifiée",
  confirmed: "Confirmée",
  completed: "Terminée",
  cancelled: "Annulée",
};

function MeetingResult({ meeting }: { meeting: MeetingRow }) {
  const navigate = useNavigate();
  const start = new Date(meeting.start_at);
  const end = new Date(meeting.end_at);
  const durationMin = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  return (
    <ResultCard onClick={() => navigate({ to: "/meetings" })}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{meeting.title}</span>
            {meeting.is_online && <Video className="h-3.5 w-3.5 text-muted-foreground" aria-label="Visio" />}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {start.toLocaleString()} · {durationMin} min
            {meeting.location ? ` · ${meeting.location}` : ""}
          </div>
          <div className="mt-1.5">
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              {MEETING_STATUS[meeting.status] ?? meeting.status}
            </Badge>
          </div>
        </div>
      </div>
    </ResultCard>
  );
}

function fileIcon(mime: string | null) {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/")) return FileImage;
  if (m.includes("spreadsheet") || m.includes("excel") || m.includes("csv")) return FileSpreadsheet;
  if (m.includes("zip") || m.includes("rar") || m.includes("tar")) return FileArchive;
  return FileText;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function DocumentResult({ doc }: { doc: DocumentRow }) {
  const navigate = useNavigate();
  const Icon = fileIcon(doc.mime_type);
  return (
    <ResultCard onClick={() => navigate({ to: "/documents" })}>
      <div className="flex items-center gap-3">
        <Icon className="h-8 w-8 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{doc.original_filename || doc.filename}</div>
          <div className="text-xs text-muted-foreground">
            {doc.source_type} · {new Date(doc.created_at).toLocaleDateString()} · {formatSize(doc.file_size)}
          </div>
        </div>
      </div>
    </ResultCard>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-6">
      {[1, 2].map((s) => (
        <section key={s}>
          <Skeleton className="mb-2 h-3 w-24" />
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-md border border-border/50 p-3">
                <Skeleton className="mb-1.5 h-3 w-1/3" />
                <Skeleton className="mb-1 h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
        </section>
      ))}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Recherche en cours...
      </div>
    </div>
  );
}
