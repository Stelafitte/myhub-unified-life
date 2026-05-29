import { useEffect, useState } from "react";
import { Inbox, Paperclip, X, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { relativeTime } from "@/lib/relative-time";
import {
  CreateTaskFromEmailDialog,
  type EmailLike,
} from "./create-task-from-email-dialog";

export function TaskRequestsPanel({ userId, onCreated }: { userId: string; onCreated?: () => void }) {
  const [emails, setEmails] = useState<EmailLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [dialogEmail, setDialogEmail] = useState<EmailLike | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("emails")
      .select("id,subject,from_address,from_name,body_text,body_html,received_at,has_attachment,labels")
      .contains("labels", ["task-todo"])
      .order("received_at", { ascending: false });
    if (error) toast.error(error.message);
    else setEmails((data ?? []) as EmailLike[]);
    setLoading(false);
  };

  useEffect(() => {
    if (userId) load();
  }, [userId]);

  const dismiss = async (e: EmailLike) => {
    const labels = (e.labels ?? []).filter((l) => l !== "task-todo");
    setEmails((prev) => prev.filter((x) => x.id !== e.id));
    const { error } = await supabase.from("emails").update({ labels }).eq("id", e.id);
    if (error) toast.error(error.message);
    else toast.success("Demande ignorée");
  };

  if (!loading && emails.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border bg-amber-500/5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Inbox className="h-4 w-4 text-amber-600" />
        <span className="text-sm font-semibold">Demandes de tâches à traiter</span>
        <Badge variant="secondary" className="ml-1">{emails.length}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">depuis vos emails reportés</span>
      </button>
      {open && (
        <ul className="divide-y border-t">
          {emails.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{e.subject || "(sans objet)"}</span>
                  {e.has_attachment && <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                    {relativeTime(e.received_at)}
                  </span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {e.from_name || e.from_address}
                </div>
              </div>
              <Button size="sm" onClick={() => setDialogEmail(e)}>Créer la tâche</Button>
              <button
                onClick={() => dismiss(e)}
                title="Ignorer"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {dialogEmail && (
        <CreateTaskFromEmailDialog
          open={!!dialogEmail}
          onOpenChange={(v) => !v && setDialogEmail(null)}
          email={dialogEmail}
          userId={userId}
          onCreated={() => {
            setDialogEmail(null);
            load();
            onCreated?.();
          }}
        />
      )}
    </div>
  );
}
