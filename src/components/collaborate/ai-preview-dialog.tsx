import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Check, X, RefreshCw } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { runEditorialAction, type EditorialAction } from "@/lib/collab-ai.functions";
import { toast } from "sonner";

const ACTION_LABELS: Record<EditorialAction, string> = {
  improve: "Améliorer",
  shorten: "Raccourcir",
  lengthen: "Allonger",
  simplify: "Simplifier",
  fix_grammar: "Corriger l'orthographe",
  change_tone: "Changer le ton",
  translate: "Traduire",
  summarize: "Résumer",
  to_bullets: "Convertir en liste à puces",
  continue: "Continuer l'écriture",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: EditorialAction | null;
  selectedText: string;
  contextBefore?: string;
  /** Called when user accepts the suggestion. Receives the suggestion text and the original action. */
  onAccept: (suggestion: string, action: EditorialAction, isContinuation: boolean) => void;
}

export function AIPreviewDialog({
  open,
  onOpenChange,
  action,
  selectedText,
  contextBefore,
  onAccept,
}: Props) {
  const runFn = useServerFn(runEditorialAction);
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string>("");
  const [tone, setTone] = useState("professionnel");
  const [language, setLanguage] = useState("anglais");

  const needsTone = action === "change_tone";
  const needsLang = action === "translate";

  const run = async () => {
    if (!action) return;
    try {
      setLoading(true);
      setSuggestion("");
      const res = await runFn({
        data: {
          action,
          text: action === "continue" ? (contextBefore || selectedText || " ") : selectedText,
          tone: needsTone ? tone : undefined,
          language: needsLang ? language : undefined,
          contextBefore: action === "continue" ? undefined : contextBefore,
        },
      });
      setSuggestion(res.suggestion);
    } catch (e) {
      toast.error("IA échouée", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && action && !needsTone && !needsLang) {
      void run();
    }
    if (!open) {
      setSuggestion("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, action]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {action ? ACTION_LABELS[action] : "Assistant IA"}
          </DialogTitle>
          <DialogDescription>
            Vérifie la suggestion avant de l'appliquer. Rien n'est modifié sans ta validation.
          </DialogDescription>
        </DialogHeader>

        {(needsTone || needsLang) && (
          <div className="grid grid-cols-1 gap-3">
            {needsTone && (
              <div className="space-y-1.5">
                <Label htmlFor="tone">Ton souhaité</Label>
                <Input
                  id="tone"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  placeholder="professionnel, chaleureux, formel, direct…"
                />
              </div>
            )}
            {needsLang && (
              <div className="space-y-1.5">
                <Label htmlFor="lang">Langue cible</Label>
                <Input
                  id="lang"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="anglais, espagnol, allemand…"
                />
              </div>
            )}
            <Button onClick={run} disabled={loading} variant="secondary" size="sm" className="w-fit">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Générer
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              {action === "continue" ? "Contexte" : "Texte d'origine"}
            </Label>
            <Textarea
              readOnly
              value={action === "continue" ? (contextBefore || "") : selectedText}
              className="min-h-[200px] resize-none text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Suggestion IA</Label>
            <Textarea
              value={suggestion}
              onChange={(e) => setSuggestion(e.target.value)}
              placeholder={loading ? "Génération en cours…" : "—"}
              className="min-h-[200px] resize-none text-sm"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-1" />
            Annuler
          </Button>
          <Button variant="outline" onClick={run} disabled={loading || !action}>
            {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Régénérer
          </Button>
          <Button
            onClick={() => {
              if (!action || !suggestion.trim()) return;
              onAccept(suggestion.trim(), action, action === "continue");
              onOpenChange(false);
            }}
            disabled={loading || !suggestion.trim()}
          >
            <Check className="h-4 w-4 mr-1" />
            Appliquer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ACTION_LABELS };
