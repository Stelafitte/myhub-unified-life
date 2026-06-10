import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  ClipboardList,
  CalendarClock,
  ExternalLink,
  UserCheck,
  Hash,
  Link2,
  FileText,
  CheckSquare,
  Paperclip,
  Vote,
  Users,
  Send,
  Lock,
  Trash2,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  getPublicSpaceFull,
  postPublicSpaceMessage,
  deletePublicSpaceMessage,
} from "@/lib/collab.functions";

const searchSchema = z.object({ g: z.string().optional() });

export const Route = createFileRoute("/space/$token")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Espace public" },
      { name: "description", content: "Espace collaboratif partagé publiquement." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PublicSpacePage,
});

function PublicSpacePage() {
  const { token } = Route.useParams();
  const { g: guestToken } = useSearch({ from: "/space/$token" });
  const fn = useServerFn(getPublicSpaceFull);
  const qc = useQueryClient();
  const queryKey = ["public-space-full", token, guestToken ?? ""];
  const { data, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: () => fn({ data: { token, guest_token: guestToken } }),
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Chargement…
      </div>
    );
  }

  if (!data?.space) {
    return (
      <div className="max-w-xl mx-auto py-16 px-4 text-center">
        <h1 className="text-xl font-semibold mb-2">Espace introuvable</h1>
        <p className="text-sm text-muted-foreground">
          Ce lien n'est pas valide ou l'espace n'est plus public.
        </p>
      </div>
    );
  }

  const {
    space,
    guest,
    messages,
    documents,
    urlLinks,
    tasks,
    meetings,
    files,
    collaborators,
    surveys,
    polls,
  } = data;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
      <div
        className="relative overflow-hidden border-b"
        style={{
          background: `linear-gradient(135deg, ${(space.color ?? "#6366f1")}22 0%, ${(space.color ?? "#6366f1")}05 60%, transparent 100%)`,
        }}
      >
        <div
          aria-hidden
          className="absolute -top-24 -right-24 h-72 w-72 rounded-full blur-3xl opacity-40"
          style={{ background: space.color ?? "#6366f1" }}
        />
        <div
          aria-hidden
          className="absolute -bottom-32 -left-24 h-72 w-72 rounded-full blur-3xl opacity-25"
          style={{ background: space.color ?? "#6366f1" }}
        />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 relative">
          <div className="flex items-start gap-4">
            <span
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl text-3xl shadow-lg ring-1 ring-border/40 backdrop-blur"
              style={{
                backgroundColor: (space.color ?? "#64748b") + "33",
                color: space.color ?? undefined,
              }}
            >
              {space.icon ?? "📁"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  Espace de travail partagé
                </Badge>
                {guest ? (
                  <Badge variant="secondary" className="text-[10px] gap-1">
                    <UserCheck className="h-3 w-3" />
                    {guest.name} · {guest.role === "contributor" ? "Contributeur" : "Lecteur"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <Lock className="h-3 w-3" /> Lien personnel requis pour participer
                  </Badge>
                )}
              </div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                {space.name}
              </h1>
              {space.public_description && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-2 max-w-2xl">
                  {space.public_description}
                </p>
              )}
              <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" /> {collaborators.length} collaborateur{collaborators.length > 1 ? "s" : ""}
                </span>
                <span className="inline-flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" /> {documents.length} doc{documents.length > 1 ? "s" : ""}
                </span>
                <span className="inline-flex items-center gap-1">
                  <CheckSquare className="h-3.5 w-3.5" /> {tasks.length} tâche{tasks.length > 1 ? "s" : ""}
                </span>
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" /> {meetings.length} réunion{meetings.length > 1 ? "s" : ""}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Hash className="h-3.5 w-3.5" /> {messages.length} message{messages.length > 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto py-6 px-3 sm:px-4 space-y-4">


      <Tabs defaultValue="chat" className="w-full">
        <TabsList className="w-full overflow-x-auto flex-nowrap justify-start">
          <TabsTrigger value="chat" className="gap-1 text-xs">
            <Hash className="h-3.5 w-3.5" /> Chat
          </TabsTrigger>
          <TabsTrigger value="links" className="gap-1 text-xs">
            <Link2 className="h-3.5 w-3.5" /> Liens
          </TabsTrigger>
          <TabsTrigger value="docs" className="gap-1 text-xs">
            <FileText className="h-3.5 w-3.5" /> Docs
          </TabsTrigger>
          <TabsTrigger value="files" className="gap-1 text-xs">
            <Paperclip className="h-3.5 w-3.5" /> Fichiers
          </TabsTrigger>
          <TabsTrigger value="tasks" className="gap-1 text-xs">
            <CheckSquare className="h-3.5 w-3.5" /> Tâches
          </TabsTrigger>
          <TabsTrigger value="meetings" className="gap-1 text-xs">
            <CalendarClock className="h-3.5 w-3.5" /> Réunions
          </TabsTrigger>
          <TabsTrigger value="polls" className="gap-1 text-xs">
            <Vote className="h-3.5 w-3.5" /> Sondages
          </TabsTrigger>
          <TabsTrigger value="collaborators" className="gap-1 text-xs">
            <Users className="h-3.5 w-3.5" /> Collab.
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="mt-3">
          <ChatPanel
            token={token}
            guestToken={guestToken}
            guest={guest}
            messages={messages}
            onPosted={() => {
              qc.invalidateQueries({ queryKey });
              refetch();
            }}
          />
        </TabsContent>

        <TabsContent value="links" className="mt-3">
          <SectionList
            empty="Aucun lien partagé."
            items={urlLinks}
            render={(l) => (
              <Card key={l.id} className="p-3">
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-sm hover:underline inline-flex items-center gap-1"
                >
                  {l.title || l.url} <ExternalLink className="h-3 w-3" />
                </a>
                {l.note && (
                  <p className="text-xs text-muted-foreground mt-0.5">{l.note}</p>
                )}
              </Card>
            )}
          />
        </TabsContent>

        <TabsContent value="docs" className="mt-3">
          <SectionList
            empty="Aucun document."
            items={documents}
            render={(d) => (
              <Card key={d.id} className="p-3 flex items-start gap-3">
                <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{d.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {d.office_provider ? `${d.office_provider} · ` : ""}
                    Maj {formatDistanceToNow(new Date(d.updated_at), { addSuffix: true, locale: fr })}
                  </div>
                </div>
                {d.office_url && (
                  <Button asChild size="sm" variant="outline">
                    <a href={d.office_url} target="_blank" rel="noreferrer">
                      Ouvrir <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  </Button>
                )}
              </Card>
            )}
          />
        </TabsContent>

        <TabsContent value="files" className="mt-3">
          <SectionList
            empty="Aucun fichier partagé."
            items={files}
            render={(f) => (
              <Card key={f.id} className="p-3 flex items-start gap-3">
                <Paperclip className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{f.original_filename}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {f.mime_type ?? "fichier"} · {(f.file_size / 1024).toFixed(0)} Ko ·{" "}
                    {format(new Date(f.created_at), "d MMM yyyy", { locale: fr })}
                  </div>
                </div>
              </Card>
            )}
          />
        </TabsContent>

        <TabsContent value="tasks" className="mt-3">
          <SectionList
            empty="Aucune tâche."
            items={tasks}
            render={(t) => (
              <Card key={t.id} className="p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{t.title}</span>
                  <Badge variant="outline" className="text-[10px]">{t.status}</Badge>
                  {t.priority && (
                    <Badge variant="secondary" className="text-[10px]">{t.priority}</Badge>
                  )}
                  {t.due_date && (
                    <span className="text-[11px] text-muted-foreground">
                      Échéance : {format(new Date(t.due_date), "d MMM yyyy", { locale: fr })}
                    </span>
                  )}
                </div>
                {t.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{t.description}</p>
                )}
              </Card>
            )}
          />
        </TabsContent>

        <TabsContent value="meetings" className="mt-3">
          <SectionList
            empty="Aucune réunion."
            items={meetings}
            render={(m) => (
              <Card key={m.id} className="p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium text-sm">{m.title}</span>
                  {m.status && (
                    <Badge variant="outline" className="text-[10px]">{m.status}</Badge>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {m.start_at
                    ? format(new Date(m.start_at), "EEEE d MMM yyyy HH:mm", { locale: fr })
                    : "Date à confirmer"}
                  {m.location ? ` · ${m.location}` : ""}
                  {m.is_online && m.online_link ? " · en ligne" : ""}
                </div>
              </Card>
            )}
          />
        </TabsContent>

        <TabsContent value="polls" className="mt-3 space-y-4">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              Sondages d'opinion <Badge variant="secondary">{surveys.length}</Badge>
            </h2>
            {surveys.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun sondage.</p>
            ) : (
              <ul className="space-y-2">
                {surveys.map((s) => (
                  <li key={s.id}>
                    <Card className="p-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{s.title}</span>
                          {s.status !== "open" && (
                            <Badge variant="outline" className="text-[10px] bg-muted">Clôturé</Badge>
                          )}
                        </div>
                        {s.deadline && (
                          <div className="text-[11px] text-muted-foreground mt-1">
                            jusqu'au {format(new Date(s.deadline), "d MMM yyyy HH:mm", { locale: fr })}
                          </div>
                        )}
                      </div>
                      {s.status === "open" && (
                        <Button asChild size="sm">
                          <a
                            href={`/survey/${s.public_token}${guestToken ? `?g=${guestToken}` : ""}`}
                          >
                            Répondre <ExternalLink className="h-3 w-3 ml-1" />
                          </a>
                        </Button>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              Sondages de réunion <Badge variant="secondary">{polls.length}</Badge>
            </h2>
            {polls.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun sondage de réunion.</p>
            ) : (
              <ul className="space-y-2">
                {polls.map((p) => (
                  <li key={p.id}>
                    <Card className="p-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{p.title}</span>
                          {p.status !== "open" && (
                            <Badge variant="outline" className="text-[10px] bg-muted">Clôturé</Badge>
                          )}
                        </div>
                        {p.deadline && (
                          <div className="text-[11px] text-muted-foreground mt-1">
                            jusqu'au {format(new Date(p.deadline), "d MMM yyyy HH:mm", { locale: fr })}
                          </div>
                        )}
                      </div>
                      {p.status === "open" && (
                        <Button asChild size="sm">
                          <a
                            href={`/poll/${p.public_token}${guestToken ? `?g=${guestToken}` : ""}`}
                          >
                            Voter <ExternalLink className="h-3 w-3 ml-1" />
                          </a>
                        </Button>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>

        <TabsContent value="collaborators" className="mt-3">
          <SectionList
            empty="Aucun collaborateur."
            items={collaborators}
            render={(c) => (
              <Card key={c.id} className="p-3 flex items-center gap-3">
                <div
                  className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                  style={{ backgroundColor: bubblePalette(c.name).bg, color: bubblePalette(c.name).fg }}

                >
                  {c.name
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((p) => p[0]?.toUpperCase())
                    .join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate flex items-center gap-2">
                    {c.name}
                    {c.invited ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {c.role === "contributor" ? "Contributeur" : "Lecteur"}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">Membre</Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {c.email ?? "—"}
                    {c.organization ? ` · ${c.organization}` : ""}
                    {c.group_names?.length ? ` · ${c.group_names.join(", ")}` : ""}
                  </div>
                </div>
                {c.last_active_at && (
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    Vu {formatDistanceToNow(new Date(c.last_active_at), { addSuffix: true, locale: fr })}
                  </span>
                )}
              </Card>
            )}
          />
        </TabsContent>

      </Tabs>

      <footer className="text-xs text-muted-foreground text-center pt-6 border-t">
        Page publique · MyHub Pro
      </footer>
      </div>
    </div>

  );
}

function SectionList<T>({
  items,
  render,
  empty,
}: {
  items: T[];
  render: (item: T) => React.ReactNode;
  empty: string;
}) {
  if (!items?.length) {
    return <p className="text-sm text-muted-foreground p-4">{empty}</p>;
  }
  return <div className="space-y-2">{items.map(render)}</div>;
}

// Palette stable par expéditeur — hash du nom → HSL pastel.
const BUBBLE_PALETTES: Array<{ bg: string; fg: string }> = [
  { bg: "hsl(210 90% 92%)", fg: "hsl(210 60% 22%)" },
  { bg: "hsl(150 60% 88%)", fg: "hsl(150 50% 20%)" },
  { bg: "hsl(35 95% 88%)", fg: "hsl(28 70% 25%)" },
  { bg: "hsl(280 70% 92%)", fg: "hsl(280 55% 28%)" },
  { bg: "hsl(0 80% 92%)", fg: "hsl(0 55% 30%)" },
  { bg: "hsl(180 55% 86%)", fg: "hsl(185 55% 22%)" },
  { bg: "hsl(50 90% 86%)", fg: "hsl(40 65% 25%)" },
  { bg: "hsl(320 65% 92%)", fg: "hsl(320 55% 30%)" },
];
function bubblePalette(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return BUBBLE_PALETTES[h % BUBBLE_PALETTES.length];
}


function ChatPanel({
  token,
  guestToken,
  guest,
  messages,
  onPosted,
}: {
  token: string;
  guestToken: string | undefined;
  guest: { id: string; name: string; role: string } | null;
  messages: Array<{
    id: string;
    content: string;
    sender_name: string | null;
    message_at: string;
    type: string;
    metadata?: unknown;
  }>;


  onPosted: () => void;
}) {
  const postFn = useServerFn(postPublicSpaceMessage);
  const delFn = useServerFn(deletePublicSpaceMessage);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const send = async () => {
    if (!guestToken || !guest) {
      toast.error("Lien personnel requis pour écrire");
      return;
    }
    if (!text.trim()) return;
    setSending(true);
    try {
      await postFn({ data: { token, guest_token: guestToken, content: text.trim() } });
      setText("");
      onPosted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (messageId: string) => {
    if (!guestToken || !guest) return;
    if (!confirm("Supprimer ce message ?")) return;
    try {
      await delFn({ data: { token, guest_token: guestToken, messageId } });
      onPosted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };


  return (
    <div className="flex flex-col border rounded-md bg-card/30 h-[60vh]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Aucun message pour l'instant.
          </p>
        ) : (
          messages.map((m) => {
            const meta =
              m.metadata && typeof m.metadata === "object" && !Array.isArray(m.metadata)
                ? (m.metadata as Record<string, unknown>)
                : null;
            const metaGuestId = typeof meta?.guest_id === "string" ? (meta.guest_id as string) : null;
            const isMine =
              !!guest &&
              (metaGuestId === guest.id ||
                (m.type === "guest" &&
                  (m.sender_name ?? "").toLowerCase() === guest.name.toLowerCase()));

            const palette = bubblePalette(m.sender_name ?? "—");
            return (
              <div
                key={m.id}
                className={`group flex ${isMine ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`relative max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${
                    isMine
                      ? "bg-primary text-primary-foreground rounded-bl-sm"
                      : "rounded-br-sm"
                  }`}
                  style={
                    isMine
                      ? undefined
                      : { backgroundColor: palette.bg, color: palette.fg }
                  }
                >
                  {!isMine && (
                    <div className="text-[11px] font-semibold mb-0.5 opacity-90">
                      {m.sender_name ?? "—"}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap text-sm leading-snug">
                    {m.content}
                  </div>
                  <div
                    className={`flex items-center gap-1 text-[10px] mt-1 ${
                      isMine ? "opacity-80 justify-end" : "opacity-70"
                    }`}
                  >
                    <span>
                      {format(new Date(m.message_at), "d MMM HH:mm", { locale: fr })}
                    </span>
                    {m.type === "guest" && !isMine ? <span>· invité</span> : null}
                    {isMine && (
                      <button
                        type="button"
                        onClick={() => handleDelete(m.id)}
                        className="opacity-0 group-hover:opacity-100 ml-1 hover:opacity-100 hover:text-destructive transition"
                        title="Supprimer mon message"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="border-t p-2 flex gap-2 items-end">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            guest
              ? `Message en tant que ${guest.name}…`
              : "Lien personnel (g=…) requis pour écrire"
          }
          rows={2}
          disabled={!guest || sending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button onClick={send} disabled={!guest || sending || !text.trim()}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
