import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Check, X, Mail, Forward, CheckSquare, CalendarPlus, Users, UserPlus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { sendEmail } from "@/lib/api/email-send.functions";
import { toast } from "sonner";
import type { ProposedAction } from "@/lib/api/ai-assistant.functions";

type Status = "pending" | "running" | "done" | "error";

const KIND_META: Record<ProposedAction["kind"], { label: string; Icon: any }> = {
  reply_email: { label: "Répondre", Icon: Mail },
  forward_email: { label: "Transférer", Icon: Forward },
  create_task: { label: "Créer une tâche", Icon: CheckSquare },
  create_event: { label: "Créer un événement", Icon: CalendarPlus },
  create_meeting: { label: "Créer une réunion", Icon: Users },
  create_contact: { label: "Créer un contact", Icon: UserPlus },
  save_document: { label: "Enregistrer un document", Icon: FileText },
};

export async function executeAction(a: ProposedAction, sendFn: ReturnType<typeof useServerFn<typeof sendEmail>>): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error("Non connecté");

  if (a.kind === "reply_email") {
    const r = await sendFn({ data: { account_id: a.account_id, to: a.to, subject: a.draft.subject, body: a.draft.body, in_reply_to: a.in_reply_to ?? undefined, references: a.references ?? undefined } });
    return "Réponse envoyée";
  }
  if (a.kind === "forward_email") {
    if (!a.to.trim()) throw new Error("Destinataire requis");
    await sendFn({ data: { account_id: a.account_id, to: a.to, subject: a.draft.subject, body: a.draft.body } });
    return "Mail transféré";
  }
  if (a.kind === "create_task") {
    const { error } = await supabase.from("tasks").insert({
      user_id: userId,
      title: a.draft.title,
      description: a.draft.description || null,
      priority: a.draft.priority,
      due_date: a.draft.due_date,
      status: "todo",
      source_email_id: a.sourceEmailId,
    });
    if (error) throw new Error(error.message);
    return "Tâche créée";
  }
  if (a.kind === "create_event") {
    if (!a.draft.start_at || !a.draft.end_at) throw new Error("Dates requises");
    const { error } = await supabase.from("calendar_events").insert({
      user_id: userId,
      title: a.draft.title,
      description: a.draft.description || null,
      start_at: a.draft.start_at,
      end_at: a.draft.end_at,
      location: a.draft.location,
      category: a.draft.category,
      is_all_day: false,
    });
    if (error) throw new Error(error.message);
    return "Événement créé";
  }
  if (a.kind === "create_meeting") {
    if (!a.draft.start_at || !a.draft.end_at) throw new Error("Dates requises");
    const { data: m, error } = await supabase.from("meetings").insert({
      user_id: userId,
      title: a.draft.title,
      description: a.draft.description || null,
      start_at: a.draft.start_at,
      end_at: a.draft.end_at,
      location: a.draft.location,
      is_online: a.draft.is_online,
    }).select("id").single();
    if (error || !m) throw new Error(error?.message ?? "Erreur");
    const parts = a.draft.participants.filter(p => p.email);
    if (parts.length > 0) {
      await supabase.from("meeting_participants").insert(parts.map(p => ({
        user_id: userId, meeting_id: m.id, name: p.name || null, email: p.email,
      })));
    }
    return "Réunion créée";
  }
  if (a.kind === "create_contact") {
    const { error } = await supabase.from("contacts").insert({
      user_id: userId,
      first_name: a.draft.first_name || null,
      last_name: a.draft.last_name || null,
      email: a.draft.email,
      phone: a.draft.phone,
      organization: a.draft.organization,
      role: a.draft.role,
      notes: a.draft.notes,
    });
    if (error) throw new Error(error.message);
    return "Contact créé";
  }
  if (a.kind === "save_document") {
    const blob = new Blob([a.draft.content], { type: "text/plain;charset=utf-8" });
    const path = `${userId}/ai/${crypto.randomUUID()}-${a.draft.filename}`;
    const up = await supabase.storage.from("documents").upload(path, blob, { contentType: "text/plain" });
    if (up.error) throw new Error(up.error.message);
    const { error } = await supabase.from("documents").insert({
      user_id: userId,
      filename: a.draft.filename,
      original_filename: a.draft.filename,
      file_size: blob.size,
      mime_type: "text/plain",
      storage_path: path,
      description: a.draft.description || null,
      source_type: "ai",
      saved_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return "Document enregistré";
  }
  throw new Error("Action non supportée");
}

export function ActionCard({
  action,
  onChange,
  onRemove,
  selected,
  onSelectChange,
  status,
  setStatus,
}: {
  action: ProposedAction;
  onChange: (a: ProposedAction) => void;
  onRemove: () => void;
  selected: boolean;
  onSelectChange: (v: boolean) => void;
  status: Status;
  setStatus: (s: Status, msg?: string) => void;
}) {
  const meta = KIND_META[action.kind];
  const Icon = meta.Icon;
  const sendFn = useServerFn(sendEmail);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setStatus("running");
    setError(null);
    try {
      const msg = await executeAction(action, sendFn);
      setStatus("done", msg);
      toast.success(msg);
    } catch (e: any) {
      const m = e?.message ?? "Erreur";
      setError(m);
      setStatus("error", m);
      toast.error(m);
    }
  };

  const setDraft = (patch: any) => onChange({ ...action, draft: { ...action.draft, ...patch } } as ProposedAction);

  return (
    <div className={`border rounded-lg bg-card p-3 space-y-2 ${status === "done" ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2">
        <Checkbox checked={selected} onCheckedChange={(v) => onSelectChange(!!v)} disabled={status === "done" || status === "running"} />
        <Icon className="h-4 w-4 text-primary" />
        <span className="font-medium text-sm">{meta.label}</span>
        {"meta" in action && (action as any).meta?.from && (
          <Badge variant="secondary" className="text-[10px]">{(action as any).meta.from}</Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          {status === "running" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {status === "done" && <Check className="h-4 w-4 text-emerald-600" />}
          {status === "error" && <span className="text-xs text-destructive">Erreur</span>}
          <Button size="sm" variant="ghost" onClick={onRemove} disabled={status === "running"} className="h-7 w-7 p-0"><X className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {/* Fields by kind */}
      {(action.kind === "reply_email" || action.kind === "forward_email") && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2">
            <Field label="À">
              <Input value={action.to} onChange={(e) => onChange({ ...action, to: e.target.value } as ProposedAction)} />
            </Field>
            <Field label="Objet">
              <Input value={action.draft.subject} onChange={(e) => setDraft({ subject: e.target.value })} />
            </Field>
            <Field label="Corps">
              <Textarea rows={6} value={action.draft.body} onChange={(e) => setDraft({ body: e.target.value })} />
            </Field>
          </div>
        </div>
      )}

      {action.kind === "create_task" && (
        <div className="space-y-2">
          <Field label="Titre"><Input value={action.draft.title} onChange={(e) => setDraft({ title: e.target.value })} /></Field>
          <Field label="Description"><Textarea rows={3} value={action.draft.description} onChange={(e) => setDraft({ description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Priorité">
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={action.draft.priority} onChange={(e) => setDraft({ priority: e.target.value })}>
                <option value="low">Basse</option><option value="medium">Moyenne</option><option value="high">Haute</option>
              </select>
            </Field>
            <Field label="Échéance">
              <Input type="datetime-local" value={toLocal(action.draft.due_date)} onChange={(e) => setDraft({ due_date: fromLocal(e.target.value) })} />
            </Field>
          </div>
        </div>
      )}

      {(action.kind === "create_event" || action.kind === "create_meeting") && (
        <div className="space-y-2">
          <Field label="Titre"><Input value={action.draft.title} onChange={(e) => setDraft({ title: e.target.value })} /></Field>
          <Field label="Description"><Textarea rows={2} value={action.draft.description} onChange={(e) => setDraft({ description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Début"><Input type="datetime-local" value={toLocal(action.draft.start_at)} onChange={(e) => setDraft({ start_at: fromLocal(e.target.value) })} /></Field>
            <Field label="Fin"><Input type="datetime-local" value={toLocal(action.draft.end_at)} onChange={(e) => setDraft({ end_at: fromLocal(e.target.value) })} /></Field>
          </div>
          <Field label="Lieu"><Input value={action.draft.location ?? ""} onChange={(e) => setDraft({ location: e.target.value })} /></Field>
          {action.kind === "create_meeting" && (
            <Field label="Participants (email, séparés par virgule)">
              <Input
                value={action.draft.participants.map(p => p.email).join(", ")}
                onChange={(e) => setDraft({ participants: e.target.value.split(",").map(s => ({ name: "", email: s.trim() })).filter(p => p.email) })}
              />
            </Field>
          )}
        </div>
      )}

      {action.kind === "create_contact" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Prénom"><Input value={action.draft.first_name} onChange={(e) => setDraft({ first_name: e.target.value })} /></Field>
            <Field label="Nom"><Input value={action.draft.last_name} onChange={(e) => setDraft({ last_name: e.target.value })} /></Field>
          </div>
          <Field label="Emails (séparés par virgule)">
            <Input value={action.draft.email.join(", ")} onChange={(e) => setDraft({ email: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} />
          </Field>
          <Field label="Téléphones">
            <Input value={action.draft.phone.join(", ")} onChange={(e) => setDraft({ phone: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Organisation"><Input value={action.draft.organization ?? ""} onChange={(e) => setDraft({ organization: e.target.value })} /></Field>
            <Field label="Rôle"><Input value={action.draft.role ?? ""} onChange={(e) => setDraft({ role: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><Textarea rows={2} value={action.draft.notes ?? ""} onChange={(e) => setDraft({ notes: e.target.value })} /></Field>
        </div>
      )}

      {action.kind === "save_document" && (
        <div className="space-y-2">
          <Field label="Nom du fichier"><Input value={action.draft.filename} onChange={(e) => setDraft({ filename: e.target.value })} /></Field>
          <Field label="Description"><Input value={action.draft.description} onChange={(e) => setDraft({ description: e.target.value })} /></Field>
          <Field label="Contenu"><Textarea rows={6} value={action.draft.content} onChange={(e) => setDraft({ content: e.target.value })} /></Field>
        </div>
      )}

      {error && <div className="text-xs text-destructive">{error}</div>}

      <div className="flex justify-end">
        <Button size="sm" onClick={run} disabled={status === "running" || status === "done"} className="gap-1.5">
          {status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <>
              {(action.kind === "reply_email" || action.kind === "forward_email") ? <Mail className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
              {action.kind === "reply_email" ? "Envoyer la réponse" : action.kind === "forward_email" ? "Transférer" : "Exécuter"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function toLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocal(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
