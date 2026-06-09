import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Trash2, X, Loader2, RefreshCw } from "lucide-react";
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

const COLLAPSE_KEY = "auto-trash-collapsed-at";
const COLLAPSE_TTL_MS = 30 * 60 * 1000; // 30 min

export function AutoTrashSuggestPanel({ emails, onTrashed, threshold = 70 }: Props) {
  const suggestFn = useServerFn(suggestTrashCandidates);
  const recordFn = useServerFn(recordTrashDecisions);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await suggestFn({ data: { threshold, limit: 30 } });
      const list = res?.suggestions ?? [];
      setSuggestions(list);
      setChecked(new Set(list.map((s) => s.id)));
      if (res?.error) setError(res.error);
      setRan(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur IA");
      setRan(true);
    } finally {
      setLoading(false);
    }
  }, [suggestFn, threshold]);

  // Auto-run on mount unless récemment réduit, et seulement si la boîte n'est pas vide
  useEffect(() => {
    if (typeof window === "undefined") return;
    const last = Number(window.localStorage.getItem(COLLAPSE_KEY) ?? 0);
    if (last && Date.now() - last < COLLAPSE_TTL_MS) {
      setCollapsed(true);
      return;
    }
    if (emails.length === 0) return;
    void runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const collapse = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(COLLAPSE_KEY, String(Date.now()));
    }
    setCollapsed(true);
  };

  const expand = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(COLLAPSE_KEY);
    }
    setCollapsed(false);
    if (!ran && !loading) void runAnalysis();
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

  const visible = suggestions.filter((s) => emails.some((e) => e.id === s.id));

  if (collapsed) {
    return (
      <div className="flex items-center justify-between border-b bg-amber-500/5 px-4 py-1.5 text-xs">
        <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
          <Sparkles className="h-3.5 w-3.5" /> Pré-tri corbeille IA
        </span>
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={expand}>
          Analyser
        </Button>
      </div>
    );
  }

  return (
    <div className="border-b bg-amber-500/10 px-4 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-amber-600" />
        <span className="font-medium text-amber-700 dark:text-amber-400">
          Pré-tri corbeille IA (seuil {threshold}%)
        </span>
        {loading ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Analyse en cours…
          </span>
        ) : error ? (
          <span className="text-destructive">⚠ {error}</span>
        ) : ran ? (
          <span className="text-muted-foreground">
            {visible.length === 0
              ? "Aucun mail suggéré — votre boîte est propre."
              : `${visible.length} mail${visible.length > 1 ? "s" : ""} suggéré${visible.length > 1 ? "s" : ""} — décoche ceux à garder`}
          </span>
        ) : (
          <span className="text-muted-foreground">Cliquez sur Analyser pour démarrer</span>
        )}
        <button
          onClick={() => void runAnalysis()}
          disabled={loading}
          className="ml-auto rounded p-1 hover:bg-amber-500/20 disabled:opacity-50"
          title="Relancer l'analyse"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button
          onClick={collapse}
          className="rounded p-1 hover:bg-amber-500/20"
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
              onClick={collapse}
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
