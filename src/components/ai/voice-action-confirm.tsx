import { useEffect, useState } from "react";
import { ShieldAlert, CheckCircle2, Mic } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { useVoiceDictation } from "@/hooks/use-voice-dictation";

export type VoiceActionPlan = {
  kind: "action";
  actionType: "delete_current_email" | "delete_emails_by_sender" | "archive_theme_emails";
  params: { emailId?: string; sender?: string; themeId?: string; themeName?: string };
  preview: { count: number; samples: { id: string; subject: string; from: string; date: string | null }[] };
  confirmationMessage: string;
  destructive: boolean;
};

/**
 * Dialogue de confirmation pour une commande vocale.
 * Active automatiquement la dictée vocale : "oui/confirme/valide/ok/exécute" → confirme ;
 * "non/annule/stop" → annule.
 */
export function VoiceActionConfirm({
  plan,
  open,
  onResult,
}: {
  plan: VoiceActionPlan | null;
  open: boolean;
  onResult: (confirmed: boolean) => void;
}) {
  const [heard, setHeard] = useState("");
  const { listening, supported, start, stop } = useVoiceDictation({
    onFinal: (txt) => {
      const t = txt.toLowerCase().trim();
      setHeard(t);
      if (/\b(oui|confirme|valide|ok|d'accord|exécute|execute|vas[- ]y|go)\b/.test(t)) {
        stop();
        onResult(true);
      } else if (/\b(non|annule|stop|laisse|arrête|arrete)\b/.test(t)) {
        stop();
        onResult(false);
      }
    },
    onError: () => {},
  });

  useEffect(() => {
    if (open && supported) {
      setHeard("");
      const id = setTimeout(() => start(), 300);
      return () => {
        clearTimeout(id);
        stop();
      };
    } else {
      stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!plan) return null;

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onResult(false); }}>
      <AlertDialogContent className="max-w-md gap-0 overflow-hidden p-0 shadow-2xl">
        <div className={`flex items-center gap-3 border-b px-5 py-3 ${plan.destructive ? "bg-destructive/10" : "bg-primary/10"}`}>
          {plan.destructive ? <ShieldAlert className="h-5 w-5 text-destructive" /> : <CheckCircle2 className="h-5 w-5 text-primary" />}
          <div className="text-sm font-semibold">{plan.destructive ? "Confirmer la suppression" : "Confirmer l'archivage"}</div>
          {listening && (
            <div className="ml-auto flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
              <Mic className="h-3 w-3 animate-pulse" /> à l'écoute…
            </div>
          )}
        </div>
        <div className="space-y-3 px-5 py-4">
          <div className="text-sm font-medium">{plan.confirmationMessage}</div>
          <div className="text-xs text-muted-foreground">
            {plan.preview.count} mail(s) concerné(s) · aperçu :
          </div>
          <ul className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1 max-h-40 overflow-auto">
            {plan.preview.samples.map((s) => (
              <li key={s.id} className="truncate">
                <span className="font-medium">{s.subject}</span> — {s.from}
                {s.date && <span className="text-muted-foreground"> · {new Date(s.date).toLocaleDateString("fr-FR")}</span>}
              </li>
            ))}
            {plan.preview.count > plan.preview.samples.length && (
              <li className="text-muted-foreground italic">… et {plan.preview.count - plan.preview.samples.length} autre(s)</li>
            )}
          </ul>
          {supported && (
            <div className="text-[11px] text-muted-foreground italic">
              Dites <b>"oui"</b> pour confirmer ou <b>"non"</b> pour annuler.
              {heard && <span className="block mt-1 text-foreground/70">Entendu : "{heard}"</span>}
            </div>
          )}
        </div>
        <AlertDialogFooter className="border-t bg-muted/30 px-5 py-3">
          <AlertDialogCancel onClick={() => onResult(false)}>Annuler</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onResult(true)}
            className={plan.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
          >
            Confirmer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
