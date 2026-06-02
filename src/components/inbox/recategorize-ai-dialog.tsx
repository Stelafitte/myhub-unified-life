import { useEffect, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { recordAiFeedback } from "@/lib/api/ai-feedback.functions";
import { toast } from "sonner";

type Theme = { id: string; name: string; archived_at: string | null };

type EmailLike = {
  id: string;
  subject: string | null;
  from_address: string | null;
  ai_theme_id: string | null;
  ai_category: string | null;
  ai_priority: string | null;
};

const CATEGORIES = ["action", "rendez-vous", "document", "facturation", "rh", "info", "newsletter"] as const;
const PRIORITIES = ["urgent", "important", "normal", "low"] as const;

export function RecategorizeAiDialog({
  open,
  onOpenChange,
  email,
  themes,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  email: EmailLike | null;
  themes: Theme[];
  onApplied?: (patch: { ai_theme_id?: string | null; ai_category?: string | null; ai_priority?: string | null }) => void;
}) {
  const [themeId, setThemeId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && email) {
      setThemeId(email.ai_theme_id);
      setCategory(email.ai_category);
      setPriority(email.ai_priority);
    }
  }, [open, email]);

  if (!email) return null;
  const activeThemes = themes.filter((t) => !t.archived_at);

  const submit = async () => {
    setSaving(true);
    try {
      const patch: { ai_theme_id?: string | null; ai_category?: string | null; ai_priority?: string | null } = {};
      if (themeId !== email.ai_theme_id) patch.ai_theme_id = themeId;
      if (category !== email.ai_category) patch.ai_category = category;
      if (priority !== email.ai_priority) patch.ai_priority = priority;

      if (Object.keys(patch).length === 0) {
        toast.info("Aucun changement");
        onOpenChange(false);
        return;
      }

      const { error } = await supabase.from("emails").update(patch).eq("id", email.id);
      if (error) throw new Error(error.message);

      // Feed AI feedback for category/priority corrections
      const fbPriority = priority !== email.ai_priority && PRIORITIES.includes(priority as typeof PRIORITIES[number])
        ? (priority as typeof PRIORITIES[number]) : null;
      const fbCategory = category !== email.ai_category && CATEGORIES.includes(category as typeof CATEGORIES[number])
        ? (category as typeof CATEGORIES[number]) : null;

      if (fbPriority || fbCategory) {
        await recordAiFeedback({
          data: {
            emailId: email.id,
            correctedPriority: fbPriority,
            correctedCategory: fbCategory,
          },
        }).catch((e) => console.warn("[ai-feedback]", e));
      }

      onApplied?.(patch as { ai_theme_id?: string | null; ai_category?: string | null; ai_priority?: string | null });
      toast.success("Recatégorisation enregistrée — l'IA apprendra de cette correction");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Recatégoriser avec l'IA
          </DialogTitle>
          <DialogDescription className="line-clamp-2">
            « {email.subject || "(sans objet)"} » — {email.from_address}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Thème</Label>
            <Select value={themeId ?? "__none__"} onValueChange={(v) => setThemeId(v === "__none__" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="Sans thème" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sans thème</SelectItem>
                {activeThemes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Catégorie</Label>
            <Select value={category ?? "__none__"} onValueChange={(v) => setCategory(v === "__none__" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="Aucune" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Aucune</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Priorité</Label>
            <Select value={priority ?? "__none__"} onValueChange={(v) => setPriority(v === "__none__" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="Aucune" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Aucune</SelectItem>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">
            Vos corrections sont envoyées au moteur d'apprentissage pour affiner les classifications futures.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Annuler</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Appliquer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
