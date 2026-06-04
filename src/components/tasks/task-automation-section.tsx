import { useEffect, useState } from "react";
import {
  Sparkles, Loader2, Search, Mail, FileText, Paperclip, Check, ChevronRight,
  Play, Pencil, Trash2, Plus, X, Eye,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { planTaskAutomation, type AutomationAction } from "@/lib/api/task-automation.functions";
import { EmailHtmlFrame } from "@/components/inbox/email-html-frame";
import { EmailAttachmentsPanel } from "@/components/inbox/email-attachments-panel";

type EmailHit = {
  id: string;
  subject: string | null;
  from_name: string | null;
  from_address: string | null;
  received_at: string | null;
  has_attachment: boolean | null;
};

type RunStep = {
  id: string;
  action: AutomationAction;
  status: "running" | "done" | "error";
  message?: string;
  emails?: EmailHit[];
};

type SavedPrompt = {
  id: string;
  name: string;
  prompt: string;
  createdAt: number;
  lastRunAt?: number;
};

type Props = {
  taskId: string | null;
  taskTitle: string;
  taskDescription: string;
  currentEmailId: string | null;
  onAttachEmail: (emailId: string) => void;
  onAppendComment: (text: string) => void;
};

const storageKey = (taskId: string | null) =>
  `myhub-task-automation-prompts:${taskId ?? "new"}`;

export function TaskAutomationSection({
  taskId,
  taskTitle,
  taskDescription,
  currentEmailId,
  onAttachEmail,
  onAppendComment,
}: Props) {
  const planFn = useServerFn(planTaskAutomation);
  const [open, setOpen] = useState(false);
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [draft, setDraft] = useState("");
  const [draftName, setDraftName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [reply, setReply] = useState<string>("");

  // Load saved prompts for this task
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(taskId));
      setPrompts(raw ? (JSON.parse(raw) as SavedPrompt[]) : []);
    } catch {
      setPrompts([]);
    }
    setSteps([]);
    setReply("");
    setActiveRunId(null);
    setEditingId(null);
    setDraft("");
    setDraftName("");
  }, [taskId]);

  const persist = (next: SavedPrompt[]) => {
    setPrompts(next);
    try {
      localStorage.setItem(storageKey(taskId), JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  };

  async function executeSearch(args: AutomationAction["args"]): Promise<EmailHit[]> {
    const limit = Math.min(Math.max(args.limit ?? 15, 1), 50);
    let q = supabase
      .from("emails")
      .select("id,subject,from_name,from_address,received_at,has_attachment")
      .order("received_at", { ascending: false })
      .limit(limit);

    // Apply each filter sequentially as AND conditions (multiple .or() reliably
    // chain in supabase-js v2 only via separate .or() that get ANDed).
    if (args.query) {
      const v = args.query.replace(/[%,()]/g, " ").trim();
      if (v) {
        q = q.or(
          [
            `subject.ilike.%${v}%`,
            `from_name.ilike.%${v}%`,
            `from_address.ilike.%${v}%`,
            `to_address.ilike.%${v}%`,
            `body_text.ilike.%${v}%`,
          ].join(","),
        );
      }
    }
    if (args.from) {
      const v = args.from.replace(/[%,()]/g, " ").trim();
      if (v) {
        q = q.or(`from_address.ilike.%${v}%,from_name.ilike.%${v}%`);
      }
    }
    if (args.subject) {
      q = q.ilike("subject", `%${args.subject}%`);
    }
    if (args.since_days && args.since_days > 0) {
      const since = new Date(Date.now() - args.since_days * 86400000).toISOString();
      q = q.gte("received_at", since);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as EmailHit[];
  }

  async function runPrompt(p: SavedPrompt) {
    if (activeRunId) return;
    setActiveRunId(p.id);
    setSteps([]);
    setReply("");
    try {
      const plan = await planFn({
        data: {
          prompt: p.prompt,
          taskTitle: taskTitle || null,
          taskDescription: taskDescription || null,
        },
      });
      setReply(plan.reply ?? "");
      if (plan.actions.length === 0) {
        toast.info("L'IA n'a proposé aucune action.");
      }
      for (const action of plan.actions) {
        const id = crypto.randomUUID();
        setSteps((s) => [...s, { id, action, status: "running" }]);
        try {
          if (action.type === "search_emails") {
            const emails = await executeSearch(action.args);
            setSteps((s) =>
              s.map((st) =>
                st.id === id
                  ? { ...st, status: "done", emails, message: `${emails.length} résultat(s)` }
                  : st,
              ),
            );
          } else if (action.type === "append_note") {
            const text = (action.args.text ?? "").trim();
            if (text) onAppendComment(text);
            setSteps((s) =>
              s.map((st) =>
                st.id === id ? { ...st, status: "done", message: "Note ajoutée" } : st,
              ),
            );
          }
        } catch (err) {
          setSteps((s) =>
            s.map((st) =>
              st.id === id
                ? { ...st, status: "error", message: err instanceof Error ? err.message : "Échec" }
                : st,
            ),
          );
        }
      }
      // mark last run time
      persist(prompts.map((x) => (x.id === p.id ? { ...x, lastRunAt: Date.now() } : x)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de la planification IA");
    } finally {
      setActiveRunId(null);
    }
  }

  function saveDraft() {
    const text = draft.trim();
    if (!text) return;
    if (editingId) {
      persist(
        prompts.map((p) =>
          p.id === editingId ? { ...p, prompt: text, name: draftName.trim() || p.name } : p,
        ),
      );
      toast.success("Prompt mis à jour");
    } else {
      const p: SavedPrompt = {
        id: crypto.randomUUID(),
        name: draftName.trim() || `Prompt ${prompts.length + 1}`,
        prompt: text,
        createdAt: Date.now(),
      };
      persist([...prompts, p]);
      toast.success("Prompt enregistré");
    }
    setDraft("");
    setDraftName("");
    setEditingId(null);
  }

  function startEdit(p: SavedPrompt) {
    setEditingId(p.id);
    setDraft(p.prompt);
    setDraftName(p.name);
  }

  function deletePrompt(id: string) {
    persist(prompts.filter((p) => p.id !== id));
    if (editingId === id) {
      setEditingId(null);
      setDraft("");
      setDraftName("");
    }
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Actions automatiques (IA)
          {prompts.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-[10px]">{prompts.length}</Badge>
          )}
        </span>
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="space-y-3 pt-1">
          {/* Saved prompt list */}
          {prompts.length > 0 && (
            <ul className="space-y-1.5">
              {prompts.map((p) => {
                const running = activeRunId === p.id;
                return (
                  <li key={p.id} className="rounded-md border bg-background p-2">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{p.name}</div>
                        <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground whitespace-pre-wrap">
                          {p.prompt}
                        </div>
                        {p.lastRunAt && (
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            Dernière exécution : {new Date(p.lastRunAt).toLocaleString()}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button" size="sm" variant="outline"
                          className="h-7 px-2"
                          disabled={!!activeRunId}
                          onClick={() => void runPrompt(p)}
                          title="Exécuter"
                        >
                          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          type="button" size="sm" variant="ghost"
                          className="h-7 px-2"
                          onClick={() => startEdit(p)}
                          title="Modifier"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button" size="sm" variant="ghost"
                          className="h-7 px-2 text-destructive hover:text-destructive"
                          onClick={() => deletePrompt(p.id)}
                          title="Supprimer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Draft / editor */}
          <div className="space-y-2 rounded-md border bg-background p-2">
            <Label className="text-xs text-muted-foreground">
              {editingId ? "Modifier le prompt" : "Nouveau prompt"}
            </Label>
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Nom (optionnel)"
              className="h-8 text-xs"
            />
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ex: trouve les mails de Veepee des 30 derniers jours et résume-les en note"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              {editingId && (
                <Button
                  type="button" size="sm" variant="ghost"
                  onClick={() => { setEditingId(null); setDraft(""); setDraftName(""); }}
                >
                  <X className="mr-1 h-3.5 w-3.5" /> Annuler
                </Button>
              )}
              <Button
                type="button" size="sm" variant="outline"
                onClick={saveDraft} disabled={!draft.trim()}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {editingId ? "Enregistrer" : "Ajouter à la liste"}
              </Button>
              <Button
                type="button" size="sm"
                disabled={!draft.trim() || !!activeRunId}
                onClick={() => {
                  // Run draft without saving — wrap in temp prompt
                  void runPrompt({
                    id: "draft", name: draftName || "Prompt", prompt: draft.trim(), createdAt: Date.now(),
                  });
                }}
              >
                {activeRunId === "draft" ? (
                  <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Exécution…</>
                ) : (
                  <><Sparkles className="mr-1 h-3.5 w-3.5" /> Lancer</>
                )}
              </Button>
            </div>
          </div>

          {/* Run results */}
          {reply && <p className="text-xs italic text-muted-foreground">{reply}</p>}

          {steps.length > 0 && (
            <ul className="space-y-2">
              {steps.map((s) => (
                <li key={s.id} className="rounded-md border bg-background p-2 text-xs">
                  <div className="flex items-center gap-2">
                    {s.status === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {s.status === "done" && <Check className="h-3.5 w-3.5 text-green-600" />}
                    {s.status === "error" && <span className="text-destructive">✕</span>}
                    {s.action.type === "search_emails" ? (
                      <Search className="h-3.5 w-3.5" />
                    ) : (
                      <FileText className="h-3.5 w-3.5" />
                    )}
                    <span className="font-medium">{s.action.label}</span>
                    {s.message && (
                      <span className="ml-auto text-muted-foreground">{s.message}</span>
                    )}
                  </div>

                  {s.emails && s.emails.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {s.emails.map((e) => {
                        const attached = currentEmailId === e.id;
                        return (
                          <li
                            key={e.id}
                            className="flex items-start gap-2 rounded border bg-muted/40 p-1.5"
                          >
                            <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">
                                {e.subject || "(sans sujet)"}
                              </div>
                              <div className="truncate text-[11px] text-muted-foreground">
                                {e.from_name || e.from_address}
                                {e.received_at && ` · ${new Date(e.received_at).toLocaleDateString()}`}
                                {e.has_attachment && (
                                  <Paperclip className="ml-1 inline h-3 w-3" />
                                )}
                              </div>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant={attached ? "secondary" : "outline"}
                              className="h-6 px-2 text-[11px]"
                              disabled={attached}
                              onClick={() => {
                                onAttachEmail(e.id);
                                toast.success("Mail attaché à la tâche (PJ inclus)");
                              }}
                            >
                              {attached ? "Attaché" : "Attacher"}
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {s.action.type === "search_emails" && s.status === "done" && (!s.emails || s.emails.length === 0) && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Aucun mail trouvé. Affine ta recherche (expéditeur exact, mots-clés du sujet, période plus large…).
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
