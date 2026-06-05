import { useState, useRef, useEffect, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles, Send, Loader2, Mail, ChevronRight, Forward, CheckSquare, CalendarPlus, Users, UserPlus, FileText, Play, User, FileBox, X, Archive, Trash2, Plus, History, Reply, ReplyAll, Star, Clock, Shield, ShieldOff, RefreshCw, Minimize2, Maximize2, Mic, MicOff } from "lucide-react";
import { useVoiceConversation } from "@/hooks/use-voice-conversation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { aiAssistantQuery, aiProposeActions, aiChat, type AiAssistantResult, type ProposedAction, type AnyMatch, type EntityKind } from "@/lib/api/ai-assistant.functions";
import { aiVoiceCommandPlan, aiVoiceCommandExecute, type AiVoicePlan } from "@/lib/api/ai-voice-command.functions";
import { VoiceActionConfirm, type VoiceActionPlan } from "@/components/ai/voice-action-confirm";
import { detectInboxControl, emitInboxControl } from "@/lib/inbox-control-bus";
import { ActionCard, executeAction } from "@/components/ai/action-card";
import { sendEmail } from "@/lib/api/email-send.functions";
import { supabase } from "@/integrations/supabase/client";
import { EmailHtmlFrame } from "@/components/inbox/email-html-frame";
import { EmailAttachmentsPanel } from "@/components/inbox/email-attachments-panel";
import { AiSuggestionsPanel } from "@/components/inbox/ai-suggestions-panel";
import { EmailComposer, type ComposerInitial } from "@/components/inbox/email-composer";
import { CreateTaskFromEmailDialog } from "@/components/tasks/create-task-from-email-dialog";
import type { CachedEmail } from "@/lib/inbox-cache";
import { toast } from "sonner";
import { confirmDialog } from "@/lib/confirm-dialog";


const ARCHIVE_KEY = "ai-assistant-archives";
type ArchivedChat = { id: string; title: string; savedAt: number; turns: Turn[] };

function loadArchives(): ArchivedChat[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]"); } catch { return []; }
}
function saveArchives(a: ArchivedChat[]) {
  try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(a.slice(0, 30))); } catch {}
}

const KIND_ICON: Record<EntityKind, any> = {
  email: Mail, contact: User, task: CheckSquare, event: CalendarPlus, meeting: Users, document: FileBox,
};

type Status = "pending" | "running" | "done" | "error";
type ActionItem = { action: ProposedAction; status: Status; message?: string };

type Turn = {
  id: string;
  mode: "search" | "chat";
  prompt: string;
  result: AiAssistantResult | null;
  chatReply: string | null;
  error: string | null;
  selectedMatches: Set<string>;
  actions: ActionItem[];
  proposing: boolean;
};

const EXAMPLES = [
  "Trouve les mails de Ternacle traitant d'IDEAL",
  "Mails de demande d'information du DIU d'échocardiographie",
  "Crée une tâche : préparer la réunion DIU vendredi",
];

const ACTION_BUTTONS: { kind: ProposedAction["kind"]; label: string; Icon: any; needsMatches?: boolean }[] = [
  { kind: "reply_email", label: "Répondre", Icon: Mail, needsMatches: true },
  { kind: "forward_email", label: "Transférer", Icon: Forward, needsMatches: true },
  { kind: "create_task", label: "Tâche", Icon: CheckSquare },
  { kind: "create_event", label: "Événement", Icon: CalendarPlus },
  { kind: "create_meeting", label: "Réunion", Icon: Users },
  { kind: "create_contact", label: "Contact", Icon: UserPlus },
  { kind: "save_document", label: "Document", Icon: FileText },
];

export function AiAssistantModal({
  open,
  onOpenChange,
  initialPrompt,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialPrompt?: string;
}) {
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [mode, setMode] = useState<"search" | "chat">("search");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [archives, setArchives] = useState<ArchivedChat[]>([]);
  const [expandedMatches, setExpandedMatches] = useState<Set<string>>(new Set());
  const [emailPreviewId, setEmailPreviewId] = useState<string | null>(null);
  const [entityPreview, setEntityPreview] = useState<{ kind: EntityKind; id: string } | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [voiceLivePreview, setVoiceLivePreview] = useState("");
  const [pendingVoiceAction, setPendingVoiceAction] = useState<VoiceActionPlan | null>(null);
  const run = useServerFn(aiAssistantQuery);
  const propose = useServerFn(aiProposeActions);
  const chatFn = useServerFn(aiChat);
  const sendFn = useServerFn(sendEmail);
  const planFn = useServerFn(aiVoiceCommandPlan);
  const execFn = useServerFn(aiVoiceCommandExecute);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const closeEmailPreview = useCallback((v: boolean) => { if (!v) setEmailPreviewId(null); }, []);
  const closeEntityPreview = useCallback((v: boolean) => { if (!v) setEntityPreview(null); }, []);

  useEffect(() => { if (open) { setTimeout(() => inputRef.current?.focus(), 60); setArchives(loadArchives()); } }, [open]);
  useEffect(() => { if (initialPrompt && open) setPrompt(initialPrompt); }, [initialPrompt, open]);

  const newConversation = () => { setTurns([]); setPrompt(""); setTimeout(() => inputRef.current?.focus(), 50); };
  const archiveConversation = () => {
    if (turns.length === 0) { toast.info("Rien à archiver."); return; }
    const title = turns[0]?.prompt.slice(0, 60) || "Conversation";
    const serializable = turns.map(t => ({ ...t, selectedMatches: Array.from(t.selectedMatches) as any }));
    const next = [{ id: crypto.randomUUID(), title, savedAt: Date.now(), turns: serializable as any }, ...archives];
    setArchives(next); saveArchives(next);
    toast.success("Conversation archivée");
    newConversation();
  };
  const restoreArchive = (a: ArchivedChat) => {
    setTurns(a.turns.map(t => ({ ...t, mode: t.mode ?? "search", chatReply: t.chatReply ?? null, selectedMatches: new Set(Array.isArray(t.selectedMatches as any) ? (t.selectedMatches as any) : []) })));
  };
  const deleteArchive = (id: string) => {
    const next = archives.filter(a => a.id !== id);
    setArchives(next); saveArchives(next);
  };
  const removeTurn = (turnId: string) => {
    setTurns(ts => ts.filter(t => t.id !== turnId));
  };

  const submit = async (overrideText?: string) => {
    const q = (overrideText ?? prompt).trim();
    if (q.length < 2) return;
    setLoading(true);
    const id = crypto.randomUUID();
    const currentMode = mode;
    setTurns((t) => [...t, { id, mode: currentMode, prompt: q, result: null, chatReply: null, error: null, selectedMatches: new Set(), actions: [], proposing: false }]);
    setPrompt("");
    try {
      if (currentMode === "chat") {
        // 0) Pilotage instantané de l'inbox (next/prev/close/first/last) — sans LLM.
        //    On laisse la priorité à un verbe d'action explicite (supprime/archive…).
        const hasActionVerb = /\b(supprime|efface|jette|archive|range|vire|enleve|enlève|met)\b/i.test(q);
        if (!hasActionVerb && window.location.pathname.startsWith("/inbox")) {
          const ctrl = detectInboxControl(q);
          if (ctrl) {
            emitInboxControl(ctrl);
            const labels: Record<string, string> = {
              next: "Email suivant",
              prev: "Email précédent",
              first: "Premier email",
              last: "Dernier email",
              close: "Retour à la liste",
              "delete-current": "Suppression de l'email courant",
              "archive-current": "Archivage de l'email courant",
              "mark-read": "Marqué comme lu",
              "mark-unread": "Marqué comme non lu",
            };
            setTurns((t) => t.map((x) => (x.id === id ? { ...x, chatReply: `✅ ${labels[ctrl.type] ?? "Action effectuée"}.` } : x)));
            return;
          }
        }
        // Détection rapide d'un verbe d'action → bascule sur le planificateur vocal
        const actionVerb = /\b(supprime|efface|jette|archive|range|vire|enleve|enlève|met)\b/i.test(q);
        if (actionVerb) {
          // Récupère l'éventuel emailId ouvert depuis l'URL (?emailId=…)
          const url = new URL(window.location.href);
          const currentEmailId = url.searchParams.get("emailId");
          try {
            const plan: AiVoicePlan = await planFn({
              data: { prompt: q, currentEmailId: currentEmailId ?? null, currentRoute: window.location.pathname },
            });
            if (plan.kind === "reply") {
              setTurns((t) => t.map((x) => (x.id === id ? { ...x, chatReply: plan.reply } : x)));
            } else {
              setTurns((t) => t.map((x) => (x.id === id ? { ...x, chatReply: `J'ai compris : ${plan.confirmationMessage}` } : x)));
              setPendingVoiceAction(plan as VoiceActionPlan);
            }
            return;
          } catch (err: any) {
            // Si le plan échoue, on retombe sur le chat libre.
            console.warn("voice command plan failed, falling back to chat", err);
          }
        }
        // Build conversation history from previous turns (any mode)
        const history: { role: "user" | "assistant"; content: string }[] = [];
        for (const t of turns) {
          history.push({ role: "user", content: t.prompt });
          const reply = t.chatReply ?? t.result?.summary ?? "";
          if (reply) history.push({ role: "assistant", content: reply.slice(0, 4000) });
        }
        history.push({ role: "user", content: q });
        const last = [...turns].reverse().find(t => t.result);
        const ctx = last?.result
          ? `Dernière recherche: "${last.prompt}"\nRésumé: ${last.result.summary.slice(0, 1500)}\nRésultats (${last.result.matches.length}): ${last.result.matches.slice(0, 8).map(m => `[${m.kind}] ${m.title}`).join(" ; ")}`
          : null;
        const res = await chatFn({ data: { messages: history, contextSummary: ctx } });
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, chatReply: res.reply } : x)));
      } else {
        const res = await run({ data: { prompt: q, contextRoute: window.location.pathname } });
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, result: res, selectedMatches: new Set(res.matches.map(m => m.id)) } : x)));
      }

    } catch (e: any) {
      const msg = e?.message ?? "Erreur IA";
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: msg } : x)));
      toast.error(msg);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const toggleMatch = (turnId: string, mid: string) => {
    setTurns(ts => ts.map(t => {
      if (t.id !== turnId) return t;
      const s = new Set(t.selectedMatches);
      s.has(mid) ? s.delete(mid) : s.add(mid);
      return { ...t, selectedMatches: s };
    }));
  };

  const toggleMatchPreview = (mid: string) => {
    setExpandedMatches(current => {
      const next = new Set(current);
      next.has(mid) ? next.delete(mid) : next.add(mid);
      return next;
    });
  };

  const openMatchPreview = (match: AnyMatch) => {
    if (match.kind === "email") {
      setEmailPreviewId(match.id);
      return;
    }
    if (match.kind === "task" || match.kind === "event" || match.kind === "meeting" || match.kind === "document") {
      setEntityPreview({ kind: match.kind, id: match.id });
      return;
    }
    toggleMatchPreview(match.id);
  };

  const SOURCE_LABEL: Record<EntityKind, string> = {
    email: "Inbox", task: "Tâches", event: "Agenda", meeting: "Réunions", document: "Plan d'opération", contact: "Contacts",
  };

  const openInSource = (kind: EntityKind, id: string, date?: string | null) => {
    onOpenChange(false);
    setEmailPreviewId(null);
    setEntityPreview(null);
    setTimeout(() => {
      if (kind === "email") navigate({ to: "/inbox", search: { emailId: id } as any });
      else if (kind === "task") navigate({ to: "/tasks", search: { taskId: id } as any });
      else if (kind === "event") navigate({ to: "/calendar", search: { eventId: id, eventAt: date ?? undefined } as any });
      else if (kind === "meeting") navigate({ to: "/meetings", search: { meetingId: id } as any });
      else if (kind === "document") navigate({ to: "/plan-operation", search: { documentId: id } as any });
      else if (kind === "contact") navigate({ to: "/contacts", search: { contactId: id } as any });
    }, 50);
  };

  const proposeFor = async (turn: Turn, kind: ProposedAction["kind"]) => {
    setTurns(ts => ts.map(t => t.id === turn.id ? { ...t, proposing: true } : t));
    try {
      // Only feed email IDs into propose (the server fn queries the emails table).
      const matchIds = Array.from(turn.selectedMatches).filter(id =>
        turn.result?.matches.find(m => m.id === id)?.kind === "email"
      );
      const res = await propose({ data: { prompt: turn.prompt, action: kind, matchIds } });
      setTurns(ts => ts.map(t => t.id === turn.id ? { ...t, actions: [...t.actions, ...res.actions.map(a => ({ action: a, status: "pending" as Status }))] } : t));
      if (res.actions.length === 0) toast.info("Aucune action générée.");
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally {
      setTurns(ts => ts.map(t => t.id === turn.id ? { ...t, proposing: false } : t));
    }
  };

  const updateAction = (turnId: string, actionId: string, updates: Partial<ActionItem>) => {
    setTurns(ts => ts.map(t => t.id !== turnId ? t : {
      ...t,
      actions: t.actions.map(a => a.action.id === actionId ? { ...a, ...updates } : a),
    }));
  };

  const removeAction = (turnId: string, actionId: string) => {
    setTurns(ts => ts.map(t => t.id !== turnId ? t : { ...t, actions: t.actions.filter(a => a.action.id !== actionId) }));
  };

  const runBulk = async (turn: Turn, mode: "all" | "selected") => {
    const targets = turn.actions.filter(it => it.status === "pending" && (mode === "all" || ((it as any).selected !== false)));
    for (const it of targets) {
      updateAction(turn.id, it.action.id, { status: "running" });
      try {
        const msg = await executeAction(it.action, sendFn);
        updateAction(turn.id, it.action.id, { status: "done", message: msg });
      } catch (e: any) {
        updateAction(turn.id, it.action.id, { status: "error", message: e?.message ?? "Erreur" });
      }
    }
    if (targets.length > 0) toast.success(`${targets.length} action(s) traitée(s)`);
  };


  const headerBar = (
    <div className={`flex flex-row items-center justify-between space-y-0 gap-2 border-b ${minimized ? "px-3 py-2" : "px-6 py-4"}`}>
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className={`text-primary shrink-0 ${minimized ? "h-4 w-4" : "h-5 w-5"}`} />
        {minimized ? (
          <span className="text-sm font-semibold truncate">Assistant IA</span>
        ) : (
          <DialogTitle className="truncate">Assistant IA</DialogTitle>
        )}
        {!minimized && <ActivePromptsBadge turns={turns} onOpenSettings={() => { onOpenChange(false); navigate({ to: "/settings", search: { tab: "ai" } as any }); }} />}
      </div>
      <div className={`flex items-center gap-1 ${minimized ? "" : "mr-6"}`}>
        {!minimized && (
          <>
            <Button size="sm" variant="ghost" onClick={newConversation} disabled={turns.length === 0} className="h-8 gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />Nouvelle
            </Button>
            <Button size="sm" variant="ghost" onClick={archiveConversation} disabled={turns.length === 0} className="h-8 gap-1.5 text-xs">
              <Archive className="h-3.5 w-3.5" />Archiver
            </Button>
            <Button size="sm" variant="ghost" onClick={async () => { if (turns.length === 0) return; if (await confirmDialog("Supprimer cette conversation ?")) newConversation(); }} disabled={turns.length === 0} className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />Supprimer
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs"><History className="h-3.5 w-3.5" />Archives ({archives.length})</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-auto">
                <DropdownMenuLabel>Conversations archivées</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {archives.length === 0 && <div className="px-2 py-3 text-xs text-muted-foreground">Aucune archive</div>}
                {archives.map(a => (
                  <DropdownMenuItem key={a.id} className="flex items-start gap-2" onSelect={(e) => { e.preventDefault(); restoreArchive(a); }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{a.title}</div>
                      <div className="text-[10px] text-muted-foreground">{new Date(a.savedAt).toLocaleString("fr-FR")}</div>
                    </div>
                    <button type="button" onClick={(e) => { e.stopPropagation(); deleteArchive(a.id); }} className="p-1 hover:bg-destructive/10 rounded text-destructive shrink-0">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        <button
          type="button"
          onClick={() => setMinimized(m => !m)}
          title={minimized ? "Agrandir" : "Réduire en mini-fenêtre"}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground"
        >
          {minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
        </button>
        {minimized && (
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            title="Fermer"
            className="p-1.5 rounded hover:bg-muted text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );

  const scrollBody = (
    <ScrollArea className={`flex-1 ${minimized ? "px-3 py-2" : "px-6 py-4"}`}>
      {turns.length === 0 && (
        <div className="space-y-4 py-8">
          <p className="text-sm text-muted-foreground text-center">
            Posez une question en langage naturel{minimized ? "" : ". L'IA cherche, résume, puis propose des actions modifiables (réponses, tâches, événements…)"}.
          </p>
          {!minimized && (
            <div className="flex flex-wrap gap-2 justify-center">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => setPrompt(ex)} className="text-xs px-3 py-1.5 rounded-full border bg-muted/40 hover:bg-muted text-foreground/80">
                  {ex}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-8">
        {turns.map((t) => (
          <div key={t.id} className="space-y-3 group">
            <div className="flex justify-end items-start gap-2">
              <button type="button" onClick={() => removeTurn(t.id)} title="Fermer cet échange" className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground mt-1">
                <X className="h-3.5 w-3.5" />
              </button>
              <div className="max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-4 py-2 text-sm whitespace-pre-wrap">{t.prompt}</div>
            </div>
            {t.mode === "chat" ? (
              <>
                {t.chatReply === null && t.error === null && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />Réflexion en cours…
                  </div>
                )}
                {t.error && <div className="text-sm text-destructive">{t.error}</div>}
                {t.chatReply && (
                  <div className="rounded-2xl border bg-card px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed max-w-[85%]">
                    {t.chatReply}
                  </div>
                )}
              </>
            ) : (
              <>
            {t.result === null && t.error === null && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />Recherche en cours…
              </div>
            )}
            {t.error && <div className="text-sm text-destructive">{t.error}</div>}
            {t.result && (
              <div className="space-y-3">
                <div className="rounded-lg border bg-muted/30 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Question</div>
                  <div className="text-xs whitespace-pre-wrap">{t.prompt}</div>
                </div>
                <div className="rounded-lg border bg-card px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Réponse de l'IA</div>
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">{t.result.summary}</div>
                </div>


                {t.result.matches.length > 0 && (
                  <div className="border rounded-lg bg-card">
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30 text-xs">
                      <Checkbox
                        checked={t.selectedMatches.size === t.result.matches.length ? true : t.selectedMatches.size === 0 ? false : "indeterminate"}
                        onCheckedChange={(v) => {
                          setTurns(ts => ts.map(x => {
                            if (x.id !== t.id) return x;
                            const all = x.result?.matches.map(m => m.id) ?? [];
                            return { ...x, selectedMatches: v ? new Set(all) : new Set() };
                          }));
                        }}
                      />
                      <span className="text-muted-foreground">{t.selectedMatches.size}/{t.result.matches.length} sélectionné(s)</span>
                      <div className="ml-auto flex gap-1">
                        <button type="button" onClick={() => setTurns(ts => ts.map(x => x.id === t.id ? { ...x, selectedMatches: new Set(x.result?.matches.map(m => m.id) ?? []) } : x))} className="text-xs px-2 py-0.5 rounded hover:bg-muted">Tout cocher</button>
                        <button type="button" onClick={() => setTurns(ts => ts.map(x => x.id === t.id ? { ...x, selectedMatches: new Set() } : x))} className="text-xs px-2 py-0.5 rounded hover:bg-muted">Tout décocher</button>
                      </div>
                    </div>
                    <div className="divide-y">
                    {t.result.matches.map((m: AnyMatch) => {
                      const checked = t.selectedMatches.has(m.id);
                      const expanded = expandedMatches.has(m.id);
                      const Icon = KIND_ICON[m.kind] ?? Mail;
                      return (
                        <div key={m.id} className="px-3 py-2 hover:bg-muted/30">
                          <div className="flex items-start gap-2">
                            <Checkbox checked={checked} onCheckedChange={() => toggleMatch(t.id, m.id)} className="mt-1" />
                            <button type="button" onClick={() => openMatchPreview(m)} className="flex items-start gap-2 flex-1 min-w-0 text-left">
                              <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium truncate">{m.title}</span>
                                  {m.date && <span className="text-[11px] text-muted-foreground shrink-0">{new Date(m.date).toLocaleDateString("fr-FR")}</span>}
                                  {m.badge && <Badge variant="secondary" className="text-[10px] shrink-0">{m.badge}</Badge>}
                                </div>
                                {m.subtitle && <div className="text-xs text-muted-foreground truncate">{m.subtitle}</div>}
                                {m.snippet && <div className="text-xs text-muted-foreground truncate">{m.snippet}</div>}
                              </div>
                              <ChevronRight className={`h-4 w-4 mt-1 text-muted-foreground shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
                            </button>
                          </div>
                          {expanded && (
                            <div className="ml-8 mt-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-foreground/90 space-y-2">
                              <div className="font-medium">{m.title}</div>
                              {m.date && <div className="text-muted-foreground">Date : {new Date(m.date).toLocaleString("fr-FR")}</div>}
                              {m.subtitle && <div>{m.subtitle}</div>}
                              {m.snippet && <div className="text-muted-foreground whitespace-pre-wrap">{m.snippet}</div>}
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openInSource(m.kind, m.id, m.date)}>
                                Ouvrir dans {SOURCE_LABEL[m.kind]}
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    </div>
                  </div>
                )}

                {/* Action toolbar */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-xs text-muted-foreground mr-1">Propositions :</span>
                  {ACTION_BUTTONS.map(({ kind, label, Icon, needsMatches }) => {
                    const hasEmailSel = Array.from(t.selectedMatches).some(id => t.result?.matches.find(x => x.id === id)?.kind === "email");
                    const disabled = t.proposing || (needsMatches && !hasEmailSel);
                    return (
                      <Button key={kind} size="sm" variant="outline" disabled={disabled} onClick={() => proposeFor(t, kind)} className="h-7 gap-1.5 text-xs">
                        <Icon className="h-3.5 w-3.5" />{label}
                      </Button>
                    );
                  })}
                  {t.proposing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>

                {/* Action cards */}
                {t.actions.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <BulkBar
                      items={t.actions}
                      onRunAll={() => runBulk(t, "all")}
                      onRunSelected={() => runBulk(t, "selected")}
                      onToggleAll={(v) => setTurns(ts => ts.map(x => x.id !== t.id ? x : { ...x, actions: x.actions.map(a => ({ ...a, selected: v } as any)) }))}
                    />

                    {t.actions.map((it) => (
                      <ActionCard
                        key={it.action.id}
                        action={it.action}
                        onChange={(a) => updateAction(t.id, it.action.id, { action: a })}
                        onRemove={() => removeAction(t.id, it.action.id)}
                        selected={(it as any).selected ?? true}
                        onSelectChange={(v) => updateAction(t.id, it.action.id, { ...(it as any), selected: v } as any)}
                        status={it.status}
                        setStatus={(s, msg) => updateAction(t.id, it.action.id, { status: s, message: msg })}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
              </>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );

  const inputBar = (
    <div className={`border-t space-y-2 ${minimized ? "p-2" : "p-3"}`}>
      {!minimized && (
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground mr-1">Mode :</span>
          <button type="button" onClick={() => setMode("search")} className={`px-2.5 py-1 rounded-full border transition ${mode === "search" ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 hover:bg-muted text-foreground/80"}`}>
            🔍 Rechercher
          </button>
          <button type="button" onClick={() => setMode("chat")} className={`px-2.5 py-1 rounded-full border transition ${mode === "chat" ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 hover:bg-muted text-foreground/80"}`}>
            💬 Discuter
          </button>
          <span className="text-[10px] text-muted-foreground ml-2 hidden sm:inline">
            {mode === "search" ? "Cherche dans vos données et propose des actions." : "Discussion libre avec contexte des recherches précédentes."}
          </span>
        </div>
      )}
      {voiceLivePreview && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-2 py-1 text-xs text-red-700 dark:text-red-300 italic">
          🎙️ {voiceLivePreview}
        </div>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!loading) submit(); } }}
          placeholder={mode === "search" ? "Ex : mes rdv perso, mails de Ternacle…" : "Ex : pourquoi tu n'as pas trouvé mes rdv kiné ?"}
          rows={minimized ? 1 : 2}
          className="resize-none"
          disabled={loading}
        />
        <Button onClick={() => submit()} disabled={loading || prompt.trim().length < 2} size="icon" className="h-10 w-10 shrink-0">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
        <VoiceConvoButton loading={loading} onSubmit={(text: string) => submit(text)} onLivePreview={setVoiceLivePreview} />
      </div>
    </div>
  );

  const handleVoiceActionResult = async (confirmed: boolean) => {
    const plan = pendingVoiceAction;
    setPendingVoiceAction(null);
    if (!plan || !confirmed) {
      if (plan) toast.info("Action annulée.");
      return;
    }
    try {
      const res = await execFn({
        data: {
          actionType: plan.actionType,
          emailId: plan.params.emailId ?? null,
          sender: plan.params.sender ?? null,
          themeId: plan.params.themeId ?? null,
        },
      });
      toast.success(res.message);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur lors de l'exécution");
    }
  };

  const previews = (
    <>
      <AiEmailReaderDialog
        emailId={emailPreviewId}
        open={!!emailPreviewId}
        onOpenChange={closeEmailPreview}
        onOpenInSource={(id) => openInSource("email", id)}
      />
      <AiEntityPreviewDialog
        entity={entityPreview}
        open={!!entityPreview}
        onOpenChange={closeEntityPreview}
        onOpenInSource={(e) => openInSource(e.kind, e.id)}
      />
      <VoiceActionConfirm
        plan={pendingVoiceAction}
        open={!!pendingVoiceAction}
        onResult={handleVoiceActionResult}
      />
    </>
  );


  if (!open) return null;

  if (minimized) {
    return (
      <>
        <div className="fixed bottom-4 right-4 z-50 flex h-[500px] w-[380px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] flex-col rounded-lg border bg-background shadow-2xl">
          {headerBar}
          {scrollBody}
          {inputBar}
        </div>
        {previews}
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-0 gap-0 h-[88vh] flex flex-col">
        <DialogHeader className="p-0 space-y-0">
          {headerBar}
        </DialogHeader>
        {scrollBody}
        {inputBar}
        {previews}
      </DialogContent>
    </Dialog>
  );
}

function VoiceConvoButton({ loading, onSubmit, onLivePreview }: { loading: boolean; onSubmit: (text: string) => void; onLivePreview: (text: string) => void }) {
  const { active, supported, toggle } = useVoiceConversation({
    isBusy: loading,
    onSubmit: (text) => {
      onLivePreview("");
      onSubmit(text);
    },
    onTranscript: (text, kind) => {
      onLivePreview(kind === "interim" ? text + " …" : text);
    },
  });
  if (!supported) return null;
  return (
    <Button
      onClick={toggle}
      size="icon"
      variant={active ? "default" : "outline"}
      title={active ? "Arrêter la conversation vocale (auto-envoi)" : "Conversation vocale (auto-envoi à la pause)"}
      className={`h-10 w-10 shrink-0 ${active ? "bg-red-500 hover:bg-red-600 text-white animate-pulse" : ""}`}
    >
      {active ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </Button>
  );
}

type AiReaderAccount = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  icon: string | null;
  credentials?: Record<string, unknown> | null;
};

function AiEmailReaderDialog({ emailId, open, onOpenChange, onOpenInSource }: { emailId: string | null; open: boolean; onOpenChange: (v: boolean) => void; onOpenInSource?: (id: string) => void }) {
  const [email, setEmail] = useState<CachedEmail | null>(null);
  const [accounts, setAccounts] = useState<AiReaderAccount[]>([]);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerInitial, setComposerInitial] = useState<ComposerInitial>({ mode: "new" });

  useEffect(() => {
    if (!open || !emailId) return;
    let cancelled = false;
    setLoading(true);
    setEmail(null);
    (async () => {
      const [{ data: auth }, { data: mail, error }, { data: accs }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("emails").select("*").eq("id", emailId).maybeSingle(),
        supabase.from("accounts").select("id,name,type,color,icon,credentials").order("created_at"),
      ]);
      if (cancelled) return;
      setUserId(auth.user?.id ?? "");
      setAccounts((accs as AiReaderAccount[]) ?? []);
      if (error || !mail) {
        toast.error("Mail introuvable");
        onOpenChange(false);
      } else {
        const loaded = mail as CachedEmail;
        setEmail(loaded);
        if (!loaded.is_read) {
          setEmail({ ...loaded, is_read: true });
          void supabase.from("emails").update({ is_read: true }).eq("id", loaded.id);
          pushEmailAction(loaded.id, loaded.account_id, "mark_read");
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [emailId, open, onOpenChange]);

  const patchEmail = async (updates: Partial<CachedEmail>) => {
    if (!email) return;
    setEmail({ ...email, ...updates });
    const { error } = await supabase.from("emails").update(updates).eq("id", email.id);
    if (error) toast.error(error.message);
  };
  const archiveEmail = async () => {
    if (!email) return;
    const { error } = await supabase.from("emails").update({ is_archived: true }).eq("id", email.id);
    if (error) toast.error(error.message);
    else { toast.success("Email archivé"); onOpenChange(false); }
  };
  const deleteEmail = async () => {
    if (!email) return;
    const now = new Date().toISOString();
    const { error } = email.deleted_at
      ? await supabase.from("emails").delete().eq("id", email.id)
      : await supabase.from("emails").update({ deleted_at: now }).eq("id", email.id);
    if (error) toast.error(error.message);
    else {
      if (!email.deleted_at) pushEmailAction(email.id, email.account_id, "trash");
      toast.success(email.deleted_at ? "Email supprimé définitivement" : "Email déplacé vers la corbeille");
      onOpenChange(false);
    }
  };
  const restoreEmail = async () => {
    if (!email) return;
    await patchEmail({ deleted_at: null });
    pushEmailAction(email.id, email.account_id, "untrash");
    toast.success("Email restauré");
  };
  const markSpam = async (asSpam: boolean) => {
    if (!email) return;
    await patchEmail(asSpam ? { spam_label: "spam", spam_score: 100, spam_reason: "Marqué manuellement" } : { spam_label: "legit", spam_score: 0, spam_reason: "Non indésirable (utilisateur)" });
    toast.success(asSpam ? "Marqué comme indésirable" : "Marqué comme légitime");
  };
  const postpone = async () => {
    if (!email) return;
    const labels = Array.from(new Set([...(email.labels ?? []), "task-todo"]));
    await patchEmail({ labels });
    toast.success("Ajouté aux demandes de tâches à traiter");
  };
  const openComposer = (init: ComposerInitial) => {
    setComposerInitial(init);
    setComposerOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[88vh] max-w-4xl flex-col overflow-hidden p-0 gap-0">
          <DialogHeader className="border-b px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="text-sm">Contenu du mail</DialogTitle>
              {email && onOpenInSource && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onOpenInSource(email.id)}>
                  Ouvrir dans Inbox
                </Button>
              )}
            </div>
          </DialogHeader>
          {loading || !email ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement du mail…
            </div>
          ) : (
            <AiEmailReader
              email={email}
              account={accounts.find((a) => a.id === email.account_id)}
              userId={userId}
              onStar={() => patchEmail({ is_starred: !email.is_starred })}
              onArchive={archiveEmail}
              onDelete={deleteEmail}
              onRestore={email.deleted_at ? restoreEmail : undefined}
              onCreateTask={() => setTaskOpen(true)}
              onPostpone={postpone}
              onCompose={openComposer}
              onMarkSpam={markSpam}
            />
          )}
        </DialogContent>
      </Dialog>
      {email && (
        <CreateTaskFromEmailDialog open={taskOpen} onOpenChange={setTaskOpen} email={email} userId={userId} />
      )}
      <EmailComposer open={composerOpen} onOpenChange={setComposerOpen} accounts={accounts} initial={composerInitial} />
    </>
  );
}

function pushEmailAction(emailId: string, accountId: string | null | undefined, action: "mark_read" | "trash" | "untrash") {
  if (!accountId) return;
  void supabase.functions.invoke("push-email-actions", { body: { email_id: emailId, action, account_id: accountId } });
}

function AiEmailReader({
  email,
  account,
  userId,
  onStar,
  onArchive,
  onDelete,
  onRestore,
  onCreateTask,
  onPostpone,
  onCompose,
  onMarkSpam,
}: {
  email: CachedEmail;
  account?: AiReaderAccount;
  userId: string;
  onStar: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRestore?: () => void;
  onCreateTask: () => void;
  onPostpone: () => void;
  onCompose: (init: ComposerInitial) => void;
  onMarkSpam: (asSpam: boolean) => void;
}) {
  const isSpamEmail = email.spam_label === "spam" || email.spam_label === "phishing";
  const isPostponed = (email.labels ?? []).includes("task-todo");
  const dateStr = email.received_at ? new Date(email.received_at).toLocaleString("fr-FR") : "";
  const sender = email.from_name ? `${email.from_name} <${email.from_address}>` : (email.from_address ?? "");
  const quoted = () => `\n\n\nLe ${dateStr}, ${sender} a écrit :\n${(email.body_text ?? "").split("\n").map((l) => "> " + l).join("\n")}`;
  const refs = email.message_id ? `<${email.message_id}>` : undefined;
  const subjReply = email.subject?.startsWith("Re:") ? email.subject : `Re: ${email.subject ?? ""}`;
  const subjFwd = email.subject?.startsWith("Fwd:") ? email.subject : `Fwd: ${email.subject ?? ""}`;
  const reply = (all: boolean) => onCompose({ mode: all ? "replyAll" : "reply", defaultAccountId: email.account_id, to: email.from_address ?? "", cc: all ? (email.to_address ?? "") : undefined, subject: subjReply, body: quoted(), inReplyTo: refs, references: refs });
  const forward = () => onCompose({ mode: "forward", defaultAccountId: email.account_id, subject: subjFwd, body: `\n\n---------- Message transféré ----------\nDe: ${sender}\nDate: ${email.received_at ?? ""}\nSujet: ${email.subject ?? ""}\nÀ: ${email.to_address ?? ""}\n\n${email.body_text ?? ""}` });

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto">
      <header className="border-b p-4">
        <div className="mb-2 flex min-w-0 items-center gap-2">
          {account && <Badge style={{ background: account.color ?? undefined }} className="border-0">{account.icon} {account.name}</Badge>}
          <button onClick={onStar} className="ml-auto text-muted-foreground hover:text-foreground" title="Étoiler">
            <Star className={`h-4 w-4 ${email.is_starred ? "fill-current text-primary" : ""}`} />
          </button>
        </div>
        <h2 className="break-words text-base font-semibold">{email.subject || "(sans objet)"}</h2>
        <div className="mt-2 space-y-0.5 break-words text-xs text-muted-foreground">
          <div><span className="font-medium text-foreground">De :</span> <span className="break-all">{sender}</span></div>
          <div><span className="font-medium text-foreground">À :</span> <span className="break-all">{email.to_address}</span></div>
          <div><span className="font-medium text-foreground">Date :</span> {dateStr}</div>
        </div>
        <div className="mt-3 flex min-w-0 flex-wrap gap-1">
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => reply(false)}><Reply className="h-3 w-3" /> Répondre</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => reply(true)}><ReplyAll className="h-3 w-3" /> Tous</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={forward}><Forward className="h-3 w-3" /> Transférer</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={onArchive}><Archive className="h-3 w-3" /> Archiver</Button>
          {onRestore && <Button size="sm" variant="outline" className="h-7 gap-1" onClick={onRestore}><RefreshCw className="h-3 w-3" /> Restaurer</Button>}
          <Button size="sm" variant="outline" className="h-7 gap-1 text-destructive" onClick={onDelete}><Trash2 className="h-3 w-3" /> {email.deleted_at ? "Suppr. définitive" : "Suppr."}</Button>
          <Button size="sm" className="h-7 gap-1" onClick={onCreateTask}><Plus className="h-3 w-3" /> Créer tâche</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={onPostpone} disabled={isPostponed}><Clock className="h-3 w-3" /> {isPostponed ? "Déjà reportée" : "Reporter"}</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => onMarkSpam(!isSpamEmail)}>{isSpamEmail ? <Shield className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />} {isSpamEmail ? "Pas indésirable" : "Indésirable"}</Button>
        </div>
      </header>
      {email.is_sensitive ? (
        <div className="border-b bg-destructive/10 px-4 py-3 text-xs text-destructive">
          Email marqué sensible : {email.sensitive_reason ?? "motif inconnu"}. Les suggestions IA sont désactivées.
        </div>
      ) : null}
      {email.has_attachment && <EmailAttachmentsPanel emailId={email.id} fromAddress={email.from_address} subject={email.subject} />}
      <div className="min-w-0 max-w-full p-4 text-sm">
        {email.body_html ? <EmailHtmlFrame html={email.body_html} /> : <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed [overflow-wrap:anywhere]">{email.body_text ?? "(vide)"}</pre>}
      </div>
      {!email.is_sensitive && (
        <AiSuggestionsPanel
          emailId={email.id}
          fromAddress={email.from_address}
          subject={email.subject}
          userId={userId}
          onCreateTask={onCreateTask}
          onArchive={onArchive}
          onUseReply={(text) => onCompose({ mode: "reply", defaultAccountId: email.account_id, to: email.from_address ?? "", subject: subjReply, body: text + quoted(), inReplyTo: refs, references: refs })}
        />
      )}
    </div>
  );
}

function BulkBar({ items, onRunAll, onRunSelected, onToggleAll }: { items: ActionItem[]; onRunAll: () => void; onRunSelected: () => void; onToggleAll?: (v: boolean) => void }) {
  const pending = items.filter(i => i.status === "pending").length;
  const selectedCount = items.filter(i => (i as any).selected !== false).length;
  const allSelected = selectedCount === items.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const hasMail = items.some(i => i.action.kind === "reply_email" || i.action.kind === "forward_email");
  const allMail = items.length > 0 && items.every(i => i.action.kind === "reply_email" || i.action.kind === "forward_email");
  const sendLabel = allMail ? "Envoyer" : hasMail ? "Envoyer / Exécuter" : "Exécuter";
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 text-xs bg-primary/10 border border-primary/30 rounded-lg px-3 py-2">
      {onToggleAll && (
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={(v) => onToggleAll(!!v)}
        />
      )}
      <Badge variant="outline" className="bg-background">{selectedCount}/{items.length} sélectionnée(s) · {pending} en attente</Badge>
      <span className="text-muted-foreground hidden sm:inline">Action individuelle sur chaque carte, ou groupée ici →</span>
      <div className="ml-auto flex gap-2">
        <Button size="sm" variant="outline" onClick={onRunSelected} disabled={pending === 0 || selectedCount === 0} className="h-8"><Play className="h-3.5 w-3.5 mr-1" />{sendLabel} la sélection</Button>
        <Button size="sm" onClick={onRunAll} disabled={pending === 0} className="h-8"><Play className="h-3.5 w-3.5 mr-1" />Tout {sendLabel.toLowerCase()}</Button>
      </div>
    </div>
  );
}



function ActivePromptsBadge({ turns, onOpenSettings }: { turns: Turn[]; onOpenSettings: () => void }) {
  const map = new Map<string, { title: string; target: string }>();
  for (const t of turns) {
    for (const p of t.result?.activePrompts ?? []) map.set(`${p.target}::${p.title}`, p);
  }
  const list = Array.from(map.values());
  const tooltip = list.length === 0 ? "Aucun prompt actif (configurable dans Réglages > IA)" : list.map((p) => `• ${p.title} (${p.target})`).join("\n");
  return (
    <button
      type="button"
      onClick={onOpenSettings}
      title={tooltip}
      className="ml-2 text-[10px] inline-flex items-center gap-1 rounded-full border bg-muted/40 hover:bg-muted px-2 py-0.5 text-foreground/80"
    >
      <Sparkles className="h-3 w-3" /> Prompts actifs : {list.length}
    </button>
  );
}



type EntityRef = { kind: EntityKind; id: string };

function AiEntityPreviewDialog({ entity, open, onOpenChange, onOpenInSource }: { entity: EntityRef | null; open: boolean; onOpenChange: (v: boolean) => void; onOpenInSource?: (e: EntityRef) => void }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entity) { setData(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const table = entity.kind === "event" ? "calendar_events"
          : entity.kind === "meeting" ? "meetings"
          : entity.kind === "task" ? "tasks"
          : "documents";
        const { data: row, error } = await supabase.from(table).select("*").eq("id", entity.id).maybeSingle();
        if (error) throw error;
        if (!cancelled) setData(row);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message ?? "Erreur de chargement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entity?.kind, entity?.id]);

  const titleMap: Record<EntityKind, string> = {
    email: "Mail", contact: "Contact", task: "Tâche", event: "Événement", meeting: "Réunion", document: "Document",
  };

  const renderBody = () => {
    if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</div>;
    if (!data) return <div className="text-sm text-muted-foreground py-8">Introuvable.</div>;
    if (!entity) return null;
    const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString("fr-FR") : "—";
    if (entity.kind === "task") {
      return (
        <div className="space-y-3 text-sm">
          <div className="text-base font-semibold">{data.title}</div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Statut : {data.status}</Badge>
            <Badge variant="secondary">Priorité : {data.priority}</Badge>
            {data.due_date && <Badge variant="outline">Échéance : {fmt(data.due_date)}</Badge>}
          </div>
          {data.description && <div className="whitespace-pre-wrap text-foreground/90 rounded-md border bg-muted/30 p-3">{data.description}</div>}
          {Array.isArray(data.tags) && data.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">{data.tags.map((t: string) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}</div>
          )}
          {data.comments && <div className="text-xs text-muted-foreground whitespace-pre-wrap"><span className="font-medium text-foreground">Commentaires :</span> {data.comments}</div>}
        </div>
      );
    }
    if (entity.kind === "event") {
      return (
        <div className="space-y-3 text-sm">
          <div className="text-base font-semibold">{data.title}</div>
          <div className="text-muted-foreground">{fmt(data.start_at)} → {fmt(data.end_at)}</div>
          {data.location && <div><span className="font-medium">Lieu :</span> {data.location}</div>}
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{data.category}</Badge>
            {data.is_all_day && <Badge variant="outline">Journée entière</Badge>}
            {data.recurrence_rule && <Badge variant="outline">Récurrent</Badge>}
          </div>
          {data.description && <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3">{data.description}</div>}
        </div>
      );
    }
    if (entity.kind === "meeting") {
      return (
        <div className="space-y-3 text-sm">
          <div className="text-base font-semibold">{data.title}</div>
          <div className="text-muted-foreground">{fmt(data.start_at)} → {fmt(data.end_at)}</div>
          {data.location && <div><span className="font-medium">Lieu :</span> {data.location}</div>}
          {data.is_online && data.online_link && (
            <div className="text-xs"><span className="font-medium">Lien :</span> <a href={data.online_link} target="_blank" rel="noreferrer" className="text-primary underline break-all">{data.online_link}</a></div>
          )}
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Statut : {data.status}</Badge>
            <Badge variant="outline">Importance : {data.importance}</Badge>
          </div>
          {data.description && <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3">{data.description}</div>}
          {data.notes && <div className="text-xs"><span className="font-medium">Notes :</span> <div className="whitespace-pre-wrap text-muted-foreground">{data.notes}</div></div>}
          {data.decisions && <div className="text-xs"><span className="font-medium">Décisions :</span> <div className="whitespace-pre-wrap text-muted-foreground">{data.decisions}</div></div>}
        </div>
      );
    }
    // document
    return (
      <div className="space-y-3 text-sm">
        <div className="text-base font-semibold break-all">{data.original_filename || data.filename}</div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{(data.file_size / 1024).toFixed(1)} Ko</span>
          {data.mime_type && <Badge variant="outline" className="text-[10px]">{data.mime_type}</Badge>}
          {data.ai_category && <Badge variant="secondary" className="text-[10px]">{data.ai_category}</Badge>}
          {data.is_sensitive && <Badge variant="destructive" className="text-[10px]">Sensible</Badge>}
        </div>
        {data.description && <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3">{data.description}</div>}
        {data.ai_summary && <div className="rounded-md border bg-muted/30 p-3 text-xs"><span className="font-medium">Résumé IA :</span> {data.ai_summary}</div>}
        {data.onedrive_web_url && (
          <a href={data.onedrive_web_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline break-all">Ouvrir dans OneDrive</a>
        )}
        {Array.isArray(data.tags) && data.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">{data.tags.map((t: string) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}</div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm text-muted-foreground">
            {entity ? titleMap[entity.kind] : ""}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] pr-2">
          {renderBody()}
        </ScrollArea>
        {entity && onOpenInSource && (
          <div className="flex justify-end border-t pt-3">
            <Button size="sm" variant="outline" onClick={() => onOpenInSource(entity)}>
              Ouvrir dans l'application
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
