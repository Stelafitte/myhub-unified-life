import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Check, Plus, Ban, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { Theme } from "@/lib/api/themes.functions";

type EmailLite = {
  id: string;
  ai_theme_id: string | null;
  from_address: string | null;
  subject: string | null;
};

const EMOJIS = ["📁", "💼", "🏠", "📧", "💰", "📅", "🎓", "✈️", "🛒", "❤️", "⚡", "🎯", "📝", "🔔", "⭐"];

export function RecategorizePopover({
  email,
  themes,
  onApplied,
}: {
  email: EmailLite;
  themes: Theme[];
  onApplied: (newThemeId: string | null, newThemes?: Theme[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"pro" | "perso">("pro");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newScope, setNewScope] = useState<"pro" | "perso">("pro");
  const [newIcon, setNewIcon] = useState("📁");
  const [busy, setBusy] = useState(false);
  const [localThemes, setLocalThemes] = useState<Theme[]>(themes);

  const current = useMemo(
    () => localThemes.find((t) => t.id === email.ai_theme_id) ?? null,
    [localThemes, email.ai_theme_id],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return localThemes
      .filter((t) => !t.archived_at && t.scope === tab)
      .filter((t) => {
        if (!q) return true;
        if (t.name.toLowerCase().includes(q)) return true;
        return (t.keywords ?? []).some((k) => k.toLowerCase().includes(q));
      });
  }, [localThemes, tab, query]);

  const apply = async (newThemeId: string | null, themesList: Theme[] = localThemes) => {
    if (busy) return;
    setBusy(true);
    try {
      const previousId = email.ai_theme_id;
      if (previousId === newThemeId) {
        setOpen(false);
        return;
      }

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Not authenticated");

      const { error: e1 } = await supabase
        .from("emails")
        .update({ ai_theme_id: newThemeId, theme_processed_at: new Date().toISOString() })
        .eq("id", email.id);
      if (e1) throw e1;

      const previousName = themesList.find((t) => t.id === previousId)?.name ?? null;
      const newName = themesList.find((t) => t.id === newThemeId)?.name ?? null;

      await supabase.from("ai_feedback").insert({
        user_id: uid,
        email_id: email.id,
        from_address: email.from_address,
        subject: email.subject,
        original_category: previousName,
        corrected_category: newName,
      });

      // Update counts (best-effort)
      if (previousId) {
        const prev = themesList.find((t) => t.id === previousId);
        if (prev) {
          await supabase
            .from("email_themes")
            .update({ email_count: Math.max(0, (prev.email_count ?? 0) - 1) })
            .eq("id", previousId);
        }
      }
      if (newThemeId) {
        const next = themesList.find((t) => t.id === newThemeId);
        if (next) {
          await supabase
            .from("email_themes")
            .update({
              email_count: (next.email_count ?? 0) + 1,
              last_email_at: new Date().toISOString(),
            })
            .eq("id", newThemeId);
        }
      }

      toast.success("Thème mis à jour", {
        description: "L'IA apprend de cette correction",
      });
      onApplied(newThemeId, themesList);
      setOpen(false);
    } catch (err) {
      toast.error("Échec de la mise à jour", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const createAndApply = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Nom requis");
      return;
    }
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("email_themes")
        .insert({
          user_id: uid,
          name,
          scope: newScope,
          icon: newIcon,
          source: "manual",
          keywords: [],
        })
        .select("*")
        .single();
      if (error) throw error;

      const created = data as Theme;
      const updated = [...localThemes, created];
      setLocalThemes(updated);
      setCreating(false);
      setNewName("");
      setBusy(false);
      await apply(created.id, updated);
    } catch (err) {
      setBusy(false);
      toast.error("Création impossible", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Recatégoriser ce mail"
          onClick={(e) => {
            e.stopPropagation();
            setLocalThemes(themes);
            setTab((current?.scope as "pro" | "perso") ?? "pro");
            setOpen(true);
          }}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-violet-500"
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="w-80 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2">
          <div className="text-sm font-semibold">Choisir un thème pour ce mail</div>
          <div className="text-xs text-muted-foreground">
            Thème actuel :{" "}
            <span className="font-medium text-foreground">
              {current ? `${current.icon ?? "📁"} ${current.name}` : "Sans thème"}
            </span>
          </div>
        </div>

        {!creating && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "pro" | "perso")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="pro" className="text-xs">📋 Pro</TabsTrigger>
              <TabsTrigger value="perso" className="text-xs">🏠 Perso</TabsTrigger>
            </TabsList>
            <TabsContent value={tab} className="mt-2">
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher un thème…"
                  className="h-8 pl-7 text-xs"
                />
              </div>
              <div className="max-h-56 overflow-y-auto rounded-md border">
                {filtered.length === 0 && (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                    Aucun thème
                  </div>
                )}
                {filtered.map((t) => {
                  const isCurrent = t.id === email.ai_theme_id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={busy}
                      onClick={() => apply(t.id)}
                      className={cn(
                        "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent",
                        isCurrent && "bg-accent/60",
                      )}
                    >
                      <span className="text-base leading-none">{t.icon ?? "📁"}</span>
                      <span className="flex-1 truncate">{t.name}</span>
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {t.email_count ?? 0}
                      </span>
                      {isCurrent && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        )}

        {creating && (
          <div className="space-y-2 rounded-md border p-2">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nom du thème"
              className="h-8 text-xs"
            />
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-muted-foreground">Scope :</span>
              <button
                type="button"
                onClick={() => setNewScope("pro")}
                className={cn(
                  "rounded px-2 py-0.5 text-xs",
                  newScope === "pro" ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                📋 Pro
              </button>
              <button
                type="button"
                onClick={() => setNewScope("perso")}
                className={cn(
                  "rounded px-2 py-0.5 text-xs",
                  newScope === "perso" ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                🏠 Perso
              </button>
            </div>
            <div>
              <div className="mb-1 text-[11px] text-muted-foreground">Icône :</div>
              <div className="flex flex-wrap gap-1">
                {EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setNewIcon(em)}
                    className={cn(
                      "h-7 w-7 rounded text-base hover:bg-accent",
                      newIcon === em && "bg-accent ring-1 ring-primary",
                    )}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setCreating(false)} disabled={busy}>
                Annuler
              </Button>
              <Button size="sm" onClick={createAndApply} disabled={busy || !newName.trim()}>
                {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Créer
              </Button>
            </div>
          </div>
        )}

        {!creating && (
          <div className="mt-2 flex flex-col gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="justify-start text-xs"
              onClick={() => {
                setCreating(true);
                setNewScope(tab);
              }}
              disabled={busy}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Créer un nouveau thème
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start text-xs text-muted-foreground"
              onClick={() => apply(null)}
              disabled={busy || email.ai_theme_id === null}
            >
              <Ban className="mr-1 h-3.5 w-3.5" /> Sans thème
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
