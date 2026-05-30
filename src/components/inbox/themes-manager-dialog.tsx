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
  type Theme,
} from "@/lib/api/themes.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, Pencil, Archive, ArchiveRestore, Trash2, GitMerge, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

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

  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);

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

  const active = themes.filter((t) => !t.archived_at);
  const archived = themes.filter((t) => t.archived_at);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Gérer les thèmes</DialogTitle>
          <DialogDescription>
            Liste dynamique des thèmes utilisés pour classer vos emails. Renommez, fusionnez, archivez à tout moment.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 border-b pb-3">
          <Input
            placeholder="Nouveau thème…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            className="h-8 max-w-xs"
          />
          <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </Button>
          <Button size="sm" variant="outline" onClick={handleDiscover} disabled={discovering} className="ml-auto">
            {discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Découverte IA
          </Button>
        </div>

        {mergeFrom && (
          <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Fusion : sélectionnez le thème de destination dans la liste ci-dessous.{" "}
            <button onClick={() => setMergeFrom(null)} className="underline">Annuler</button>
          </div>
        )}

        <div className="max-h-[400px] overflow-y-auto">
          {loading && <div className="py-4 text-center text-sm text-muted-foreground">Chargement…</div>}
          {!loading && active.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Aucun thème actif. Cliquez sur « Découverte IA » pour démarrer.
            </div>
          )}
          <ul className="divide-y">
            {active.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-2">
                {editing === t.id ? (
                  <>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleRename(t.id)}
                      className="h-7 max-w-xs"
                      autoFocus
                    />
                    <Button size="sm" className="h-7" onClick={() => handleRename(t.id)}>OK</Button>
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(null)}>Annuler</Button>
                  </>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{t.name}</span>
                        <Badge variant="secondary" className="text-[10px]">{t.email_count}</Badge>
                        <Badge variant="outline" className="text-[10px]">{t.source}</Badge>
                      </div>
                      {t.description && (
                        <div className="truncate text-xs text-muted-foreground">{t.description}</div>
                      )}
                    </div>
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
                  </>
                )}
              </li>
            ))}
          </ul>

          {archived.length > 0 && (
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
