import { useState } from "react";
import { Sparkles, Loader2, Search, Mail, FileText, Paperclip, Check, ChevronRight } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { planTaskAutomation, type AutomationAction } from "@/lib/api/task-automation.functions";

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

type Props = {
  taskTitle: string;
  taskDescription: string;
  currentEmailId: string | null;
  onAttachEmail: (emailId: string) => void;
  onAppendComment: (text: string) => void;
};

export function TaskAutomationSection({
  taskTitle,
  taskDescription,
  currentEmailId,
  onAttachEmail,
  onAppendComment,
}: Props) {
  const planFn = useServerFn(planTaskAutomation);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [reply, setReply] = useState<string>("");

  async function executeSearch(args: AutomationAction["args"]): Promise<EmailHit[]> {
    let q = supabase
      .from("emails")
      .select("id,subject,from_name,from_address,received_at,has_attachment")
      .is("deleted_at", null)
      .order("received_at", { ascending: false })
      .limit(Math.min(Math.max(args.limit ?? 10, 1), 25));

    const filters: string[] = [];
    if (args.query) {
      const v = args.query.replace(/[%,]/g, " ");
      filters.push(
        `subject.ilike.%${v}%,body_text.ilike.%${v}%,from_name.ilike.%${v}%,from_address.ilike.%${v}%`,
      );
    }
    if (filters.length > 0) q = q.or(filters.join(","));
    if (args.from) q = q.or(`from_address.ilike.%${args.from}%,from_name.ilike.%${args.from}%`);
    if (args.subject) q = q.ilike("subject", `%${args.subject}%`);
    if (args.since_days && args.since_days > 0) {
      const since = new Date(Date.now() - args.since_days * 86400000).toISOString();
      q = q.gte("received_at", since);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as EmailHit[];
  }

  async function run() {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setSteps([]);
    setReply("");
    try {
      const plan = await planFn({
        data: {
          prompt: prompt.trim(),
          taskTitle: taskTitle || null,
          taskDescription: taskDescription || null,
        },
      });
      setReply(plan.reply ?? "");
      if (plan.actions.length === 0) {
        toast.info("L'IA n'a proposé aucune action.");
        return;
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
                ? {
                    ...st,
                    status: "error",
                    message: err instanceof Error ? err.message : "Échec",
                  }
                : st,
            ),
          );
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de la planification IA");
    } finally {
      setRunning(false);
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
        </span>
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="space-y-2 pt-1">
          <Label className="text-xs text-muted-foreground">
            Décris ce que l'IA doit faire (rechercher des mails par sujet/expéditeur, ajouter des notes, etc.)
          </Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ex: trouve les mails de Veepee des 30 derniers jours et résume-les en note"
            rows={3}
            disabled={running}
          />
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={run} disabled={running || !prompt.trim()}>
              {running ? (
                <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Exécution…</>
              ) : (
                <><Sparkles className="mr-2 h-3.5 w-3.5" /> Lancer</>
              )}
            </Button>
          </div>

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
                </li>
              ))}
            </ul>
          )}

          {steps.length > 0 && (
            <div className="flex justify-end">
              <Badge variant="secondary" className="text-[10px]">
                Tu peux lancer une nouvelle demande pour enchaîner des actions
              </Badge>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
