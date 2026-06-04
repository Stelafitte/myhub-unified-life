import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles, Send, Loader2, Mail, X, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { aiAssistantQuery, type AiAssistantResult } from "@/lib/api/ai-assistant.functions";
import { toast } from "sonner";

type Turn = {
  id: string;
  prompt: string;
  result: AiAssistantResult | null;
  error: string | null;
};

const EXAMPLES = [
  "Trouve les mails de Ternacle traitant d'IDEAL",
  "Mails non lus de cette semaine sur le DIU",
  "Mails de demande d'information sur l'échocardiographie",
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
  const navigate = useNavigate();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  useEffect(() => {
    if (initialPrompt && open) setPrompt(initialPrompt);
  }, [initialPrompt, open]);

  const submit = async () => {
    const q = prompt.trim();
    if (q.length < 2) return;
    setLoading(true);
    const id = crypto.randomUUID();
    setTurns((t) => [...t, { id, prompt: q, result: null, error: null }]);
    setPrompt("");
    try {
      const res = await run({ data: { prompt: q, contextRoute: window.location.pathname } });
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, result: res } : x)));
    } catch (e: any) {
      const msg = e?.message ?? "Erreur IA";
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: msg } : x)));
      toast.error(msg);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-0 gap-0 h-[85vh] flex flex-col">
        <DialogHeader className="px-6 py-4 border-b flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <DialogTitle>Assistant IA</DialogTitle>
            <Badge variant="secondary" className="ml-2 text-[10px]">Phase 1 · Mails</Badge>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          {turns.length === 0 && (
            <div className="space-y-4 py-8">
              <p className="text-sm text-muted-foreground text-center">
                Posez une question en langage naturel. L'IA cherche dans vos mails et résume les résultats.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setPrompt(ex)}
                    className="text-xs px-3 py-1.5 rounded-full border bg-muted/40 hover:bg-muted text-foreground/80"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-6">
            {turns.map((t) => (
              <div key={t.id} className="space-y-3">
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-4 py-2 text-sm whitespace-pre-wrap">
                    {t.prompt}
                  </div>
                </div>
                {t.result === null && t.error === null && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Recherche en cours…
                  </div>
                )}
                {t.error && (
                  <div className="text-sm text-destructive">{t.error}</div>
                )}
                {t.result && (
                  <div className="space-y-3">
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{t.result.summary}</div>
                    {t.result.matches.length > 0 && (
                      <div className="border rounded-lg divide-y bg-card">
                        {t.result.matches.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              onOpenChange(false);
                              navigate({ to: "/inbox", search: { emailId: m.id } as any });
                            }}
                            className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                          >
                            <Mail className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className={`text-sm truncate ${m.is_read ? "" : "font-semibold"}`}>
                                  {m.from_name ?? m.from_address ?? "(inconnu)"}
                                </span>
                                {m.received_at && (
                                  <span className="text-[11px] text-muted-foreground shrink-0">
                                    {new Date(m.received_at).toLocaleDateString("fr-FR")}
                                  </span>
                                )}
                              </div>
                              <div className="text-sm truncate">{m.subject ?? "(sans objet)"}</div>
                              <div className="text-xs text-muted-foreground truncate">{m.snippet}</div>
                            </div>
                            <ChevronRight className="h-4 w-4 mt-1 text-muted-foreground shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground italic">
                      Actions proposées (réponses, tâches, événements…) — disponible dans la phase 2.
                    </div>
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!loading) submit();
              }
            }}
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
