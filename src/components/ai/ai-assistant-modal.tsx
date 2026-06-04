import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles, Send, Loader2, Mail, ChevronRight, Forward, CheckSquare, CalendarPlus, Users, UserPlus, FileText, Play } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { aiAssistantQuery, aiProposeActions, type AiAssistantResult, type ProposedAction } from "@/lib/api/ai-assistant.functions";
import { ActionCard, executeAction } from "@/components/ai/action-card";
import { sendEmail } from "@/lib/api/email-send.functions";
import { toast } from "sonner";

type Status = "pending" | "running" | "done" | "error";
type ActionItem = { action: ProposedAction; status: Status; message?: string };

type Turn = {
  id: string;
  prompt: string;
  result: AiAssistantResult | null;
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
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const run = useServerFn(aiAssistantQuery);
  const propose = useServerFn(aiProposeActions);
  const sendFn = useServerFn(sendEmail);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 60); }, [open]);
  useEffect(() => { if (initialPrompt && open) setPrompt(initialPrompt); }, [initialPrompt, open]);

  const submit = async () => {
    const q = prompt.trim();
    if (q.length < 2) return;
    setLoading(true);
    const id = crypto.randomUUID();
    setTurns((t) => [...t, { id, prompt: q, result: null, error: null, selectedMatches: new Set(), actions: [], proposing: false }]);
    setPrompt("");
    try {
      const res = await run({ data: { prompt: q, contextRoute: window.location.pathname } });
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, result: res, selectedMatches: new Set(res.matches.map(m => m.id)) } : x)));
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

  const proposeFor = async (turn: Turn, kind: ProposedAction["kind"]) => {
    setTurns(ts => ts.map(t => t.id === turn.id ? { ...t, proposing: true } : t));
    try {
      const matchIds = Array.from(turn.selectedMatches);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-0 gap-0 h-[88vh] flex flex-col">
        <DialogHeader className="px-6 py-4 border-b flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <DialogTitle>Assistant IA</DialogTitle>
            <Badge variant="secondary" className="ml-2 text-[10px]">Phase 2 · Recherche + Actions</Badge>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          {turns.length === 0 && (
            <div className="space-y-4 py-8">
              <p className="text-sm text-muted-foreground text-center">
                Posez une question en langage naturel. L'IA cherche, résume, puis propose des actions modifiables (réponses, tâches, événements…).
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" onClick={() => setPrompt(ex)} className="text-xs px-3 py-1.5 rounded-full border bg-muted/40 hover:bg-muted text-foreground/80">
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-8">
            {turns.map((t) => (
              <div key={t.id} className="space-y-3">
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-4 py-2 text-sm whitespace-pre-wrap">{t.prompt}</div>
                </div>
                {t.result === null && t.error === null && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />Recherche en cours…
                  </div>
                )}
                {t.error && <div className="text-sm text-destructive">{t.error}</div>}
                {t.result && (
                  <div className="space-y-3">
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{t.result.summary}</div>

                    {t.result.matches.length > 0 && (
                      <div className="border rounded-lg divide-y bg-card">
                        {t.result.matches.map((m) => {
                          const checked = t.selectedMatches.has(m.id);
                          return (
                            <div key={m.id} className="flex items-start gap-2 px-3 py-2 hover:bg-muted/30">
                              <Checkbox checked={checked} onCheckedChange={() => toggleMatch(t.id, m.id)} className="mt-1" />
                              <button
                                type="button"
                                onClick={() => { onOpenChange(false); navigate({ to: "/inbox", search: { emailId: m.id } as any }); }}
                                className="flex items-start gap-2 flex-1 min-w-0 text-left"
                              >
                                <Mail className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className={`text-sm truncate ${m.is_read ? "" : "font-semibold"}`}>{m.from_name ?? m.from_address ?? "(inconnu)"}</span>
                                    {m.received_at && <span className="text-[11px] text-muted-foreground shrink-0">{new Date(m.received_at).toLocaleDateString("fr-FR")}</span>}
                                  </div>
                                  <div className="text-sm truncate">{m.subject ?? "(sans objet)"}</div>
                                  <div className="text-xs text-muted-foreground truncate">{m.snippet}</div>
                                </div>
                                <ChevronRight className="h-4 w-4 mt-1 text-muted-foreground shrink-0" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Action toolbar */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-xs text-muted-foreground mr-1">Propositions :</span>
                      {ACTION_BUTTONS.map(({ kind, label, Icon, needsMatches }) => {
                        const disabled = t.proposing || (needsMatches && t.selectedMatches.size === 0);
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
                        <BulkBar items={t.actions} onRunAll={() => runBulk(t, "all")} onRunSelected={() => runBulk(t, "selected")} />
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
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="border-t p-3 flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!loading) submit(); } }}
            placeholder="Ex : trouve les mails de Ternacle traitant d'IDEAL"
            rows={2}
            className="resize-none"
            disabled={loading}
          />
          <Button onClick={submit} disabled={loading || prompt.trim().length < 2} size="icon" className="h-10 w-10 shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BulkBar({ items, onRunAll, onRunSelected }: { items: ActionItem[]; onRunAll: () => void; onRunSelected: () => void }) {
  const pending = items.filter(i => i.status === "pending").length;
  return (
    <div className="flex items-center gap-2 text-xs">
      <Badge variant="outline">{items.length} action(s) · {pending} en attente</Badge>
      <div className="ml-auto flex gap-2">
        <Button size="sm" variant="outline" onClick={onRunSelected} disabled={pending === 0} className="h-7"><Play className="h-3.5 w-3.5 mr-1" />Exécuter sélection</Button>
        <Button size="sm" onClick={onRunAll} disabled={pending === 0} className="h-7"><Play className="h-3.5 w-3.5 mr-1" />Tout exécuter</Button>
      </div>
    </div>
  );
}

