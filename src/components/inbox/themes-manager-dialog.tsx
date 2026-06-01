import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listThemes,
  renameTheme,
  archiveTheme,
  unarchiveTheme,
  deleteTheme,
  mergeThemes,
  createTheme,
  discoverThemes,
  setThemeUtility,
  setThemeScope,
  autoDetectThemeScopes,
  type Theme,
  type ThemeUtility,
  type ThemeScope,
} from "@/lib/api/themes.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, Pencil, Archive, ArchiveRestore, Trash2, GitMerge, Plus, Loader2, Wand2, Briefcase, Heart, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const UTILITY_LABELS: Record<ThemeUtility, string> = {
  faible: "Faible",
  modere: "Modéré",
  fort: "Fort",
};
const UTILITY_STYLES: Record<ThemeUtility, string> = {
  faible: "data-[active=true]:bg-muted data-[active=true]:text-muted-foreground",
  modere: "data-[active=true]:bg-blue-500/15 data-[active=true]:text-blue-700 dark:data-[active=true]:text-blue-300",
  fort: "data-[active=true]:bg-emerald-500/15 data-[active=true]:text-emerald-700 dark:data-[active=true]:text-emerald-300",
};

function UtilitySelector({
  value,
  onChange,
}: {
  value: ThemeUtility;
  onChange: (v: ThemeUtility) => void;
}) {
  return (
    <div className="inline-flex h-7 items-center rounded-md border bg-background p-0.5" title="Niveau d'utilité pour l'IA">
      {(["faible", "modere", "fort"] as ThemeUtility[]).map((lvl) => (
        <button
          key={lvl}
          data-active={value === lvl}
          onClick={() => onChange(lvl)}
          className={cn(
            "h-6 rounded px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground",
            UTILITY_STYLES[lvl],
          )}
        >
          {UTILITY_LABELS[lvl]}
        </button>
      ))}
    </div>
  );
}

function ScopeToggle({
  value,
  onChange,
}: {
  value: ThemeScope;
  onChange: (v: ThemeScope) => void;
}) {
  return (
    <div className="inline-flex h-7 items-center rounded-md border bg-background p-0.5" title="Portée du thème (Pro ou Perso)">
      <button
        data-active={value === "pro"}
        onClick={() => onChange("pro")}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground",
          "data-[active=true]:bg-blue-500/15 data-[active=true]:text-blue-700 dark:data-[active=true]:text-blue-300",
        )}
      >
        <Briefcase className="h-3 w-3" /> Pro
      </button>
      <button
        data-active={value === "perso"}
        onClick={() => onChange("perso")}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground",
          "data-[active=true]:bg-rose-500/15 data-[active=true]:text-rose-700 dark:data-[active=true]:text-rose-300",
        )}
      >
        <Heart className="h-3 w-3" /> Perso
      </button>
    </div>
  );
}

export function ThemesManagerDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged?: () => void;
}) {
  const listFn = useServerFn(listThemes);
  const renameFn = useServerFn(renameTheme);
  const archiveFn = useServerFn(archiveTheme);
  const unarchiveFn = useServerFn(unarchiveTheme);
  const deleteFn = useServerFn(deleteTheme);
  const mergeFn = useServerFn(mergeThemes);
  const createFn = useServerFn(createTheme);
  const discoverFn = useServerFn(discoverThemes);
  const setUtilityFn = useServerFn(setThemeUtility);
  const setScopeFn = useServerFn(setThemeScope);
  const autoDetectFn = useServerFn(autoDetectThemeScopes);

  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);
  const [tab, setTab] = useState<"pro" | "perso">("pro");

  const refresh = async () => {
    setLoading(true);
    const r = await listFn();
    setThemes(r.themes);
    setLoading(false);
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    const r = await renameFn({ data: { id, name: editName.trim() } });
    if (!r.ok) toast.error(r.error ?? "Erreur");
    setEditing(null);
    await refresh();
    onChanged?.();
  };

  const handleArchive = async (t: Theme) => {
    const fn = t.archived_at ? unarchiveFn : archiveFn;
    await fn({ data: { id: t.id } });
    await refresh();
    onChanged?.();
  };

  const handleDelete = async (t: Theme) => {
    if (!confirm(`Supprimer "${t.name}" ? Les emails associés seront reclassés.`)) return;
    await deleteFn({ data: { id: t.id } });
    await refresh();
    onChanged?.();
  };

  const handleMerge = async (intoId: string) => {
    if (!mergeFrom || mergeFrom === intoId) return;
    await mergeFn({ data: { fromId: mergeFrom, intoId } });
    setMergeFrom(null);
    await refresh();
    onChanged?.();
    toast.success("Thèmes fusionnés");
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const r = await createFn({ data: { name: newName.trim() } });
    if (!r.theme) toast.error(r.error ?? "Erreur");
    setNewName("");
    await refresh();
    onChanged?.();
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    const r = await discoverFn();
    setDiscovering(false);
    if (r.error) toast.error(r.error);
    else toast.success(`${r.created} thème(s) découvert(s) par l'IA`);
    await refresh();
    onChanged?.();
  };

  const handleAutoDetect = async () => {
    setDetecting(true);
    const r = await autoDetectFn();
    setDetecting(false);
    if ("error" in r && r.error) toast.error(r.error as string);
    else toast.success(`${r.updated} thème(s) classé(s) Pro/Perso`);
    await refresh();
    onChanged?.();
  };

  const handleSetUtility = async (id: string, level: ThemeUtility) => {
    setThemes((prev) => prev.map((t) => (t.id === id ? { ...t, utility_level: level } : t)));
    await setUtilityFn({ data: { id, utility_level: level } });
    onChanged?.();
  };

  const handleSetScope = async (id: string, scope: ThemeScope) => {
    const theme = themes.find((t) => t.id === id);
    setThemes((prev) => prev.map((t) => (t.id === id ? { ...t, scope } : t)));
    await setScopeFn({ data: { id, scope } });
    toast.success(`« ${theme?.name ?? "Thème"} » déplacé dans ${scope === "pro" ? "Pro" : "Perso"}`);
    onChanged?.();
  };

  const active = themes.filter((t) => !t.archived_at);
  const archived = themes.filter((t) => t.archived_at);
  const proCount = active.filter((t) => t.scope === "pro").length;
  const persoCount = active.filter((t) => t.scope === "perso").length;
  const visible = active.filter((t) => t.scope === tab);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-4xl overflow-hidden p-0">
        <DialogHeader className="px-6 pb-0 pt-6 pr-12">
          <DialogTitle>Gérer les thèmes</DialogTitle>
          <DialogDescription>
            Niveau d'utilité (faible / modéré / fort) et portée (pro / perso) permettent à l'IA de mieux pondérer le classement et les suggestions.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 border-b px-6 pb-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="flex min-w-0 items-center gap-2">
            <Input
              placeholder="Nouveau thème…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="h-8 min-w-0 flex-1"
            />
            <Button size="sm" onClick={handleCreate} disabled={!newName.trim()} className="shrink-0">
              <Plus className="h-3.5 w-3.5" /> Ajouter
            </Button>
          </div>
          <div className="flex min-w-0 flex-wrap justify-start gap-2 sm:justify-end">
            <Button size="sm" variant="outline" onClick={handleAutoDetect} disabled={detecting} className="shrink-0">
              {detecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              Détecter Pro/Perso
            </Button>
            <Button size="sm" variant="outline" onClick={handleDiscover} disabled={discovering} className="shrink-0">
              {discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Découverte IA
            </Button>
          </div>
        </div>

        {mergeFrom && (
          <div className="mx-6 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Fusion : sélectionnez le thème de destination dans la liste ci-dessous.{" "}
            <button onClick={() => setMergeFrom(null)} className="underline">Annuler</button>
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as "pro" | "perso")} className="min-w-0 px-6 pb-6">
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
            <div className="max-h-[48vh] overflow-y-auto pr-1">
              {loading && <div className="py-4 text-center text-sm text-muted-foreground">Chargement…</div>}
              {!loading && visible.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Aucun thème {tab === "pro" ? "professionnel" : "personnel"}. Utilisez « Détecter Pro/Perso » ou changez la portée d'un thème.
                </div>
              )}
              <ul className="divide-y">
                {visible.map((t) => (
                  <li key={t.id} className="py-2">
                    {editing === t.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleRename(t.id)}
                          className="h-7 max-w-xs"
                          autoFocus
                        />
                        <Button size="sm" className="h-7" onClick={() => handleRename(t.id)}>OK</Button>
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(null)}>Annuler</Button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {/* Ligne 1 : nom + meta */}
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">{t.name}</span>
                          <Badge variant="secondary" className="shrink-0 text-[10px]">{t.email_count}</Badge>
                          <Badge variant="outline" className="shrink-0 text-[10px]">{t.source}</Badge>
                        </div>
                        {t.description && (
                          <div className="truncate text-xs text-muted-foreground">{t.description}</div>
                        )}
                        {/* Ligne 2 : contrôles */}
                        <div className="flex flex-wrap items-center gap-2">
                          <UtilitySelector
                            value={t.utility_level}
                            onChange={(lvl) => handleSetUtility(t.id, lvl)}
                          />
                          <ScopeToggle
                            value={t.scope}
                            onChange={(s) => handleSetScope(t.id, s)}
                          />
                          <div className="ml-auto flex items-center gap-0.5">
                            {mergeFrom && mergeFrom !== t.id ? (
                              <Button size="sm" variant="default" className="h-7" onClick={() => handleMerge(t.id)}>
                                Fusionner ici
                              </Button>
                            ) : (
                              <>
                                <Button size="icon" variant="ghost" className="h-7 w-7" title="Renommer"
                                  onClick={() => { setEditing(t.id); setEditName(t.name); }}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7" title="Fusionner avec…"
                                  onClick={() => setMergeFrom(t.id)}>
                                  <GitMerge className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7" title="Archiver"
                                  onClick={() => handleArchive(t)}>
                                  <Archive className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Supprimer"
                                  onClick={() => handleDelete(t)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              {archived.length > 0 && tab === "perso" && (
                <>
                  <div className="mt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Archivés
                  </div>
                  <ul className="divide-y opacity-60">
                    {archived.map((t) => (
                      <li key={t.id} className="flex items-center gap-2 py-2">
                        <span className="flex-1 truncate text-sm">{t.name}</span>
                        <Badge variant="secondary" className="text-[10px]">{t.email_count}</Badge>
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Restaurer"
                          onClick={() => handleArchive(t)}>
                          <ArchiveRestore className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Supprimer"
                          onClick={() => handleDelete(t)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export function EmailThemePicker({
  value,
  themes,
  onChange,
}: {
  value: string | null;
  themes: Theme[];
  onChange: (id: string | null) => void;
}) {
  const active = themes.filter((t) => !t.archived_at);
  return (
    <Select value={value ?? "__none__"} onValueChange={(v) => onChange(v === "__none__" ? null : v)}>
      <SelectTrigger className="h-7 w-auto gap-1 text-xs">
        <SelectValue placeholder="Sans thème" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__" className="text-xs">Sans thème</SelectItem>
        {active.map((t) => (
          <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
