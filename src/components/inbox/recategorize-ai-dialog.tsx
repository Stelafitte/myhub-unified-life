import { useEffect, useMemo, useState } from "react";
import { Sparkles, Loader2, Search, Briefcase, Heart, Check, Ban, Plus } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { createTheme, setThemeScope, type Theme } from "@/lib/api/themes.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type EmailLike = {
  id: string;
  subject: string | null;
  from_address: string | null;
  ai_theme_id?: string | null;
};

export function RecategorizeAiDialog({
  open,
  onOpenChange,
  email,
  themes,
  onApplied,
  onThemesChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  email: EmailLike | null;
  themes: Theme[];
  onApplied?: (patch: { ai_theme_id: string | null }) => void;
  onThemesChanged?: () => void;
}) {
  const createFn = useServerFn(createTheme);
  const setScopeFn = useServerFn(setThemeScope);
  const [tab, setTab] = useState<"pro" | "perso">("pro");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open && email) {
      setSelected(email.ai_theme_id ?? null);
      setSearch("");
      setNewName("");
      const current = themes.find((t) => t.id === email.ai_theme_id);
      if (current?.scope === "perso") setTab("perso");
      else setTab("pro");
    }
  }, [open, email, themes]);

  const active = useMemo(() => themes.filter((t) => !t.archived_at), [themes]);
  const proCount = active.filter((t) => t.scope === "pro").length;
  const persoCount = active.filter((t) => t.scope === "perso").length;
  const visible = active.filter(
    (t) =>
      t.scope === tab &&
      (!search.trim() || t.name.toLowerCase().includes(search.trim().toLowerCase())),
  );

  if (!email) return null;

  const applyTheme = async (themeId: string | null) => {
    if (!email) return;
    setSaving(true);
    try {
      const previous = email.ai_theme_id ?? null;
      const { error } = await supabase
        .from("emails")
        .update({ ai_theme_id: themeId, theme_processed_at: new Date().toISOString() })
        .eq("id", email.id);
      if (error) throw new Error(error.message);

      // Log correction for AI learning (non-blocking)
      if (previous !== themeId) {
        const prevName = themes.find((t) => t.id === previous)?.name ?? null;
        const nextName = themes.find((t) => t.id === themeId)?.name ?? null;
        const { data: u } = await supabase.auth.getUser();
        if (u.user) {
          supabase.from("ai_feedback").insert({
            user_id: u.user.id,
            email_id: email.id,
            from_address: email.from_address,
            subject: email.subject,
            original_category: prevName,
            corrected_category: nextName,
          }).then(({ error: e }) => { if (e) console.warn("[ai_feedback]", e.message); });
        }
      }

      onApplied?.({ ai_theme_id: themeId });
      toast.success(themeId
        ? `Reclassé dans « ${themes.find((t) => t.id === themeId)?.name ?? "thème"} » — l'IA apprendra`
        : "Thème retiré — l'IA apprendra");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const r = await createFn({ data: { name: newName.trim(), scope: tab } });
      if (!r.theme) {
        toast.error(r.error ?? "Impossible de créer le thème");
        return;
      }
      setNewName("");
      onThemesChanged?.();
      // auto-select the new theme
      setSelected(r.theme.id);
      toast.success(`Thème « ${r.theme.name} » créé`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="px-6 pb-0 pt-6 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Recatégoriser avec l'IA
          </DialogTitle>
          <DialogDescription className="line-clamp-2">
            « {email.subject || "(sans objet)"} » — {email.from_address}
            <br />
            <span className="text-[11px]">Choisissez le bon thème — votre correction est mémorisée pour affiner les classifications futures.</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 border-b px-6 pb-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <Input
            placeholder={`Nouveau thème ${tab === "pro" ? "Pro" : "Perso"}…`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            className="h-8"
          />
          <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || creating} className="shrink-0">
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Créer
          </Button>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "pro" | "perso")} className="min-w-0 px-6 pb-2">
          <div className="mb-2 flex items-center gap-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Input
              placeholder="Rechercher un thème…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <TabsList className="grid w-full min-w-0 grid-cols-2">
            <TabsTrigger value="pro" className="gap-1.5">
              <Briefcase className="h-3.5 w-3.5" /> Pro
              <Badge variant="secondary" className="ml-1 text-[10px]">{proCount}</Badge>
            </TabsTrigger>
            <TabsTrigger value="perso" className="gap-1.5">
              <Heart className="h-3.5 w-3.5" /> Personnel
              <Badge variant="secondary" className="ml-1 text-[10px]">{persoCount}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-2 min-w-0">
            <div className="max-h-[42vh] overflow-y-auto pr-1">
              {visible.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Aucun thème {tab === "pro" ? "professionnel" : "personnel"}. Créez-en un ci-dessus.
                </div>
              ) : (
                <ul className="divide-y">
                  {visible.map((t) => {
                    const isSel = selected === t.id;
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(t.id)}
                          className={cn(
                            "flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-muted/50",
                            isSel && "bg-primary/10 hover:bg-primary/15",
                          )}
                        >
                          <div
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                              isSel ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                            )}
                          >
                            {isSel && <Check className="h-3 w-3" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-medium">{t.name}</span>
                              <Badge variant="secondary" className="shrink-0 text-[10px]">{t.email_count}</Badge>
                              <Badge variant="outline" className="shrink-0 text-[10px]">{t.source}</Badge>
                            </div>
                            {t.description && (
                              <div className="truncate text-xs text-muted-foreground">{t.description}</div>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between gap-2 border-t px-6 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => applyTheme(null)}
            disabled={saving}
            className="text-muted-foreground"
          >
            <Ban className="mr-1.5 h-3.5 w-3.5" /> Sans thème
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              Annuler
            </Button>
            <Button
              size="sm"
              onClick={() => applyTheme(selected)}
              disabled={saving || selected === (email.ai_theme_id ?? null)}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Appliquer
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
