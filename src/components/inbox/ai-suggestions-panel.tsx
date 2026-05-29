import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Plus, CalendarPlus, Archive, Copy, Mail, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  getEmailSuggestions,
  type EmailSuggestions,
} from "@/lib/api/email-suggestions.functions";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  emailId: string;
  fromAddress: string | null;
  subject: string | null;
  userId: string;
  onCreateTask: (title: string) => void;
  onArchive: () => void;
};

export function AiSuggestionsPanel({
  emailId,
  fromAddress,
  subject,
  userId,
  onCreateTask,
  onArchive,
}: Props) {
  const fn = useServerFn(getEmailSuggestions);
  const [data, setData] = useState<EmailSuggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    setEditing(null);
    try {
      const res = await fn({ data: { emailId } });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur IA");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailId]);

  const addEvent = async () => {
    if (!data?.event) return;
    const { error: err } = await supabase.from("calendar_events").insert({
      user_id: userId,
      title: data.event.title,
      start_at: data.event.start,
      end_at: data.event.end ?? data.event.start,
      source: null,
    });
    if (err) toast.error(err.message);
    else toast.success("Événement ajouté à l'agenda");
  };

  const openMailto = (text: string) => {
    const to = fromAddress ?? "";
    const subj = subject?.startsWith("Re:") ? subject : `Re: ${subject ?? ""}`;
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(text)}`;
  };

  return (
    <div className="border-b bg-primary/5 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
        <Sparkles className="h-3.5 w-3.5" />
        Actions suggérées par l'IA
        <button
          onClick={load}
          className="ml-auto text-muted-foreground hover:text-foreground"
          title="Régénérer"
          disabled={loading}
        >
          <RefreshCw className={loading ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Analyse en cours…
        </div>
      )}
      {error && <div className="text-xs text-destructive">{error}</div>}

      {data && !loading && (
        <div className="space-y-2.5">
          {data.taskTitle && (
            <Button
              size="sm"
              variant="outline"
              className="h-auto w-full justify-start gap-2 whitespace-normal py-2 text-left"
              onClick={() => onCreateTask(data.taskTitle!)}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span className="text-xs">
                <span className="font-medium">Créer une tâche :</span> {data.taskTitle}
              </span>
            </Button>
          )}

          {data.event && (
            <div className="rounded-md border bg-background p-2 text-xs">
              <div className="mb-1.5 font-medium">📅 RDV détecté</div>
              <div className="mb-2 text-muted-foreground">
                {data.event.title} <br />
                {new Date(data.event.start).toLocaleString("fr-FR")}
              </div>
              <Button size="sm" className="h-7 gap-1 text-xs" onClick={addEvent}>
                <CalendarPlus className="h-3 w-3" /> Ajouter à l'agenda
              </Button>
            </div>
          )}

          {data.archiveSuggested && (
            <Button
              size="sm"
              variant="outline"
              className="h-auto w-full justify-start gap-2 py-2 text-left text-xs"
              onClick={onArchive}
            >
              <Archive className="h-3.5 w-3.5" />
              Newsletter détectée — archiver ?
            </Button>
          )}

          {data.replies.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-muted-foreground">
                💬 Réponses suggérées
              </div>
              {data.replies.map((r, i) => (
                <div key={i} className="rounded-md border bg-background p-2 text-xs">
                  <div className="mb-1 font-medium">{r.label}</div>
                  {editing === i ? (
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      className="mb-1.5 min-h-[100px] text-xs"
                    />
                  ) : (
                    <div className="mb-1.5 line-clamp-3 whitespace-pre-wrap text-muted-foreground">
                      {r.text}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {editing === i ? (
                      <>
                        <Button
                          size="sm"
                          className="h-6 gap-1 text-[11px]"
                          onClick={() => openMailto(draft)}
                        >
                          <Mail className="h-3 w-3" /> Ouvrir mail
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[11px]"
                          onClick={() => setEditing(null)}
                        >
                          Annuler
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 gap-1 text-[11px]"
                          onClick={() => {
                            setEditing(i);
                            setDraft(r.text);
                          }}
                        >
                          Modifier
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 gap-1 text-[11px]"
                          onClick={() => {
                            navigator.clipboard.writeText(r.text);
                            toast.success("Réponse copiée");
                          }}
                        >
                          <Copy className="h-3 w-3" /> Copier
                        </Button>
                        <Button
                          size="sm"
                          className="h-6 gap-1 text-[11px]"
                          onClick={() => openMailto(r.text)}
                        >
                          <Mail className="h-3 w-3" /> Utiliser
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!data.taskTitle &&
            !data.event &&
            !data.archiveSuggested &&
            data.replies.length === 0 && (
              <div className="text-xs text-muted-foreground">
                Aucune action suggérée pour cet email.
              </div>
            )}
        </div>
      )}
    </div>
  );
}
