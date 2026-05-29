import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Check, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { recordAiFeedback } from "@/lib/api/ai-feedback.functions";

const PRIORITIES = [
  { v: "urgent", l: "🔴 Urgent" },
  { v: "important", l: "🟠 Important" },
  { v: "normal", l: "🟡 Normal" },
  { v: "low", l: "🟢 Faible" },
];
const CATEGORIES = [
  { v: "action", l: "📋 Action" },
  { v: "rendez-vous", l: "📅 RDV" },
  { v: "document", l: "📄 Document" },
  { v: "facturation", l: "💶 Facturation" },
  { v: "rh", l: "👥 RH" },
  { v: "info", l: "ℹ️ Info" },
  { v: "newsletter", l: "📰 Newsletter" },
];

type Props = {
  emailId: string;
  priority: string | null | undefined;
  category: string | null | undefined;
  onUpdated: (p: string | null, c: string | null) => void;
};

export function AiClassificationFeedback({ emailId, priority, category, onUpdated }: Props) {
  const fn = useServerFn(recordAiFeedback);
  const [saving, setSaving] = useState(false);
  const [pri, setPri] = useState(priority ?? "");
  const [cat, setCat] = useState(category ?? "");

  const dirty = (pri && pri !== (priority ?? "")) || (cat && cat !== (category ?? ""));

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await fn({
        data: {
          emailId,
          correctedPriority: pri && pri !== (priority ?? "") ? (pri as never) : null,
          correctedCategory: cat && cat !== (category ?? "") ? (cat as never) : null,
        },
      });
      onUpdated(pri || null, cat || null);
      toast.success("Correction enregistrée — l'IA apprendra de ce choix");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  if (!priority && !category) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs">
      <Sparkles className="h-3 w-3 text-primary" />
      <span className="text-muted-foreground">Classification IA :</span>
      <Select value={pri} onValueChange={setPri}>
        <SelectTrigger className="h-7 w-[130px] text-xs"><SelectValue placeholder="Priorité" /></SelectTrigger>
        <SelectContent>
          {PRIORITIES.map((p) => (<SelectItem key={p.v} value={p.v} className="text-xs">{p.l}</SelectItem>))}
        </SelectContent>
      </Select>
      <Select value={cat} onValueChange={setCat}>
        <SelectTrigger className="h-7 w-[150px] text-xs"><SelectValue placeholder="Catégorie" /></SelectTrigger>
        <SelectContent>
          {CATEGORIES.map((c) => (<SelectItem key={c.v} value={c.v} className="text-xs">{c.l}</SelectItem>))}
        </SelectContent>
      </Select>
      {dirty && (
        <button
          onClick={save}
          disabled={saving}
          className="ml-auto inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Corriger
        </button>
      )}
    </div>
  );
}
