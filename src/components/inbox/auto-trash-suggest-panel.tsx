import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Trash2, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  suggestTrashCandidates,
  recordTrashDecisions,
} from "@/lib/api/trash-suggest.functions";
import type { CachedEmail } from "@/lib/inbox-cache";

type Suggestion = { id: string; score: number; reason: string };

type Props = {
  emails: CachedEmail[];
  onTrashed: (ids: string[]) => void;
  threshold?: number;
};

const DISMISS_KEY = "auto-trash-dismissed-at";
const DISMISS_TTL_MS = 30 * 60 * 1000; // 30 min

export function AutoTrashSuggestPanel({ emails, onTrashed, threshold = 75 }: Props) {
  const suggestFn = useServerFn(suggestTrashCandidates);
  const recordFn = useServerFn(recordTrashDecisions);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Auto-fetch on mount when not recently dismissed and inbox not empty.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const last = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
    if (last && Date.now() - last < DISMISS_TTL_MS) {
      setDismissed(true);
      return;
    }
    if (emails.length < 5) return;
    let cancelled = false;
    setLoading(true);
    suggestFn({ data: { threshold, limit: 30 } })
      .then((res) => {
        if (cancelled) return;
        const list = res?.suggestions ?? [];
        setSuggestions(list);
        setChecked(new Set(list.map((s) => s.id)));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
    setDismissed(true);
  };

  const sendToTrash = async () => {
    if (checked.size === 0) return;
    setSubmitting(true);
    const trashIds = Array.from(checked);
    const keepIds = suggestions.filter((s) => !checked.has(s.id)).map((s) => s.id);
    const now = new Date().toISOString();
    try {
      const { error } = await supabase.from("emails").update({ deleted_at: now }).in("id", trashIds);
      if (error) throw error;
      onTrashed(trashIds);
      toast.success(`${trashIds.length} mail${trashIds.length > 1 ? "s" : ""} envoyé${trashIds.length > 1 ? "s" : ""} à la corbeille`);
      // Record decisions for learning
      const scoreById = new Map(suggestions.map((s) => [s.id, s.score]));
      await recordFn({
        data: {
          decisions: [
            ...trashIds.map((id) => ({ email_id: id, decision: "trash" as const, ai_score: scoreById.get(id) })),
            ...keepIds.map((id) => ({ email_id: id, decision: "keep" as const, ai_score: scoreById.get(id) })),
          ],
        },
      }).catch(() => {});
      setSuggestions([]);
      setChecked(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  };

  if (dismissed) return null;
  if (!loading && suggestions.length === 0) return null;

  const visible = suggestions.filter((s) => emails.some((e) => e.id === s.id));
  if (!loading && visible.length === 0) return null;

  return (
    <div className="border-b bg-amber-500/10 px-4 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-amber-600" />
        <span className="font-medium text-amber-700 dark:text-amber-400">
          Pré-tri corbeille IA
        </span>
        {loading ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Analyse en cours…
          </span>
        ) : (
          <span className="text-muted-foreground">
            {visible.length} mail{visible.length > 1 ? "s" : ""} suggéré{visible.length > 1 ? "s" : ""} — décoche ceux à garder
          </span>
        )}
        <button
          onClick={dismiss}
          className="ml-auto rounded p-1 hover:bg-amber-500/20"
          title="Masquer (30 min)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!loading && visible.length > 0 && (
        <>
          <div className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1">
            {visible.map((s) => {
              const e = emails.find((x) => x.id === s.id);
              if (!e) return null;
              return (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 hover:bg-amber-500/10"
                >
                  <input
                    type="checkbox"
                    checked={checked.has(s.id)}
                    onChange={(ev) => {
                      setChecked((prev) => {
                        const n = new Set(prev);
                        if (ev.target.checked) n.add(s.id);
                        else n.delete(s.id);
                        return n;
                      });
                    }}
                    className="mt-0.5 h-3.5 w-3.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate font-medium">
                        {e.from_name || e.from_address || "Inconnu"}
                      </span>
                      <span className="shrink-0 rounded bg-amber-500/20 px-1 text-[10px] text-amber-700 dark:text-amber-300">
                        {s.score}%
                      </span>
                    </div>
                    <div className="truncate text-muted-foreground">
                      {e.subject || "(sans objet)"}
                    </div>
                    {s.reason && (
                      <div className="truncate text-[10px] italic text-amber-700/80 dark:text-amber-400/80">
                        {s.reason}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={dismiss}
            >
              Plus tard
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={sendToTrash}
              disabled={checked.size === 0 || submitting}
            >
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Envoyer à la corbeille ({checked.size})
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
