import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Download, Cloud, Sparkles, Folder, ChevronRight, Home, FolderPlus, Check } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { type DocumentRow, getSignedUrl } from "@/lib/documents";
import {
  listOneDriveFolders,
  listOneDriveChildren,
  createOneDriveFolder,
  suggestOneDriveFolderAI,
  recordFolderChoice,
  type OneDriveFolder,
} from "@/lib/api/onedrive.functions";
import { uploadFileToOneDrive } from "@/lib/api/onedrive-upload.functions";

type Props = {
  doc: DocumentRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context?: { fromAddress?: string | null; subject?: string | null; emailId?: string | null };
};



type Crumb = { id: string; name: string };
type ChildItem = { id: string; name: string; childCount: number };
type AiPick = { path: string; reason: string; score: number; folder: OneDriveFolder | null };

const ROOT: Crumb = { id: "root", name: "OneDrive" };

export function DownloadOptionsDialog({ doc, open, onOpenChange, context }: Props) {
  const [allFolders, setAllFolders] = useState<OneDriveFolder[]>([]);
  const [allLoaded, setAllLoaded] = useState(false);

  const [crumbs, setCrumbs] = useState<Crumb[]>([ROOT]);
  const [children, setChildren] = useState<ChildItem[]>([]);
  const [childrenLoading, setChildrenLoading] = useState(false);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiPicks, setAiPicks] = useState<AiPick[]>([]);

  const [picked, setPicked] = useState<{ id: string; path: string } | null>(null);
  const [busy, setBusy] = useState<"local" | "onedrive" | "newfolder" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const uploadFn = useServerFn(uploadFileToOneDrive);
  const listAllFn = useServerFn(listOneDriveFolders);
  const listChildrenFn = useServerFn(listOneDriveChildren);
  const createFolderFn = useServerFn(createOneDriveFolder);
  const aiFn = useServerFn(suggestOneDriveFolderAI);
  const recordFn = useServerFn(recordFolderChoice);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setCrumbs([ROOT]);
    setPicked(null);
    setError(null);
    setAiPicks([]);
    setAllFolders([]);
    setAllLoaded(false);
    setCreating(false);
    setNewName("");
  }, [open]);

  // Load children of current folder
  const currentId = crumbs[crumbs.length - 1].id;
  const loadChildren = useCallback(
    async (parentId: string) => {
      setChildrenLoading(true);
      try {
        const r = await listChildrenFn({ data: { parentId } });
        setChildren(r.children);
      } catch (e) {
        setError(e instanceof Error ? e.message : "OneDrive indisponible");
        setChildren([]);
      } finally {
        setChildrenLoading(false);
      }
    },
    [listChildrenFn],
  );

  useEffect(() => {
    if (!open) return;
    void loadChildren(currentId);
  }, [open, currentId, loadChildren]);

  // Background: full tree + AI suggestions
  useEffect(() => {
    if (!open || !doc) return;
    let cancelled = false;
    (async () => {
      setAiLoading(true);
      try {
        const r = await listAllFn();
        if (cancelled) return;
        setAllFolders(r.folders);
        setAllLoaded(true);
        if (r.folders.length === 0) { setAiPicks([]); return; }

        const paths = r.folders.map((f) => f.path);
        const ai = await aiFn({
          data: {
            filename: doc.original_filename,
            mimeType: doc.mime_type ?? undefined,
            subject: context?.subject ?? undefined,
            fromAddress: context?.fromAddress ?? undefined,
            emailId: context?.emailId ?? undefined,
            bodyHint: undefined,
            paths,
          },
        });
        if (cancelled) return;
        const byPath = new Map(r.folders.map((f) => [f.path, f]));
        setAiPicks(
          ai.picks.map((p) => ({ ...p, folder: byPath.get(p.path) ?? null })).filter((p) => p.folder),
        );
      } catch (e) {
        if (!cancelled) {
          console.warn("AI suggest failed", e);
          setAiPicks([]);
        }
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, doc, context?.subject, context?.fromAddress, listAllFn, aiFn]);

  // Navigate into folder
  function enter(child: ChildItem) {
    setCrumbs((c) => [...c, { id: child.id, name: child.name }]);
  }
  function goTo(idx: number) {
    setCrumbs((c) => c.slice(0, idx + 1));
  }

  // Jump to a suggested folder via its path (using allFolders for ancestor chain)
  function jumpToFolder(folder: OneDriveFolder) {
    const parts = folder.path.split("/");
    // Reconstruct crumb chain by matching ancestor paths in allFolders
    const chain: Crumb[] = [ROOT];
    for (let i = 0; i < parts.length; i++) {
      const sub = parts.slice(0, i + 1).join("/");
      const f = allFolders.find((x) => x.path === sub);
      if (f) chain.push({ id: f.id, name: f.name });
    }
    setCrumbs(chain);
    setPicked({ id: folder.id, path: folder.path });
  }

  const currentPath = useMemo(() => crumbs.slice(1).map((c) => c.name).join("/") || "(racine)", [crumbs]);

  async function downloadLocal() {
    if (!doc?.storage_path) return;
    setBusy("local");
    try {
      const url = await getSignedUrl(doc.storage_path);
      const a = document.createElement("a");
      a.href = url; a.download = doc.original_filename; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      toast.success("Téléchargement lancé");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    } finally { setBusy(null); }
  }

  async function uploadToOneDrive() {
    if (!doc?.storage_path) return;
    // Default to current folder if nothing explicitly picked
    const target = picked ?? (currentId !== "root" ? { id: currentId, path: currentPath } : null);
    if (!target) { toast.error("Choisis un dossier de destination"); return; }
    setBusy("onedrive");
    try {
      await uploadFn({ data: { storagePath: doc.storage_path, folderId: target.id, filename: doc.original_filename } });
      toast.success(`Envoyé dans OneDrive › ${target.path}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec OneDrive");
    } finally { setBusy(null); }
  }

  async function createSubfolder() {
    if (!newName.trim()) return;
    setBusy("newfolder");
    try {
      const r = await createFolderFn({ data: { parentId: currentId, name: newName.trim() } });
      toast.success(`Dossier « ${r.name} » créé`);
      setNewName(""); setCreating(false);
      await loadChildren(currentId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Création impossible");
    } finally { setBusy(null); }
  }

  const targetLabel = picked?.path ?? (currentId === "root" ? null : currentPath);

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="flex max-h-[90vh] max-w-xl flex-col gap-0 overflow-hidden bg-background p-0">
        <DialogHeader className="shrink-0 border-b bg-background px-6 pb-3 pt-5">
          <DialogTitle className="truncate">Télécharger « {doc?.original_filename} »</DialogTitle>
          <DialogDescription>Choisis la destination du fichier.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto bg-background px-6 py-4">

          {/* Local */}
          <button
            type="button"
            onClick={downloadLocal}
            disabled={busy !== null}
            className="flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
          >
            <Download className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <div className="text-sm font-medium">Dossier Téléchargements</div>
              <div className="text-xs text-muted-foreground">Téléchargement local via le navigateur</div>
            </div>
            {busy === "local" && <Loader2 className="h-4 w-4 animate-spin" />}
          </button>

          {/* OneDrive */}
          <div className="rounded-md border">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-sm font-medium">
              <Cloud className="h-4 w-4 text-primary" /> OneDrive Personnel
            </div>

            {error ? (
              <div className="p-4 text-xs text-muted-foreground">{error}</div>
            ) : (
              <div className="space-y-3 p-3">
                {/* AI suggestions */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> Suggestions IA
                    {aiLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                  </div>
                  {!aiLoading && aiPicks.length === 0 && (
                    <div className="rounded-md border border-dashed px-2 py-2 text-[11px] text-muted-foreground">
                      {allLoaded
                        ? "Aucune correspondance évidente. Choisis manuellement ci-dessous."
                        : "Analyse des dossiers en cours…"}
                    </div>
                  )}
                  {aiPicks.map((p) => (
                    <div
                      key={p.path}
                      className={cn(
                        "flex items-center gap-2 rounded-md border p-2 text-sm",
                        picked?.path === p.path ? "border-primary bg-primary/5" : "",
                      )}
                    >
                      <Folder className="h-4 w-4 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{p.path}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{p.reason}</div>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">{p.score}%</Badge>
                      <Button
                        size="sm"
                        variant={picked?.path === p.path ? "default" : "outline"}
                        className="h-7 px-2 text-xs"
                        onClick={() => p.folder && jumpToFolder(p.folder)}
                      >
                        {picked?.path === p.path ? <Check className="h-3.5 w-3.5" /> : "Choisir"}
                      </Button>
                    </div>
                  ))}
                </div>

                {/* Navigator */}
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">Navigation manuelle</div>

                  {/* Breadcrumb */}
                  <div className="flex flex-wrap items-center gap-0.5 rounded-md border bg-background px-2 py-1 text-xs">
                    {crumbs.map((c, i) => (
                      <span key={`${c.id}-${i}`} className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => goTo(i)}
                          className={cn(
                            "rounded px-1.5 py-0.5 hover:bg-muted",
                            i === crumbs.length - 1 && "font-medium text-foreground",
                          )}
                        >
                          {i === 0 ? <Home className="inline h-3 w-3" /> : c.name}
                        </button>
                        {i < crumbs.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                      </span>
                    ))}
                  </div>

                  {/* Children */}
                  <ScrollArea className="h-48 rounded-md border">
                    <div className="p-1">
                      {childrenLoading ? (
                        <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement…
                        </div>
                      ) : children.length === 0 ? (
                        <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                          Ce dossier ne contient pas de sous-dossier.
                        </div>
                      ) : (
                        children.map((c) => (
                          <div
                            key={c.id}
                            className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted/50"
                          >
                            <button
                              type="button"
                              onClick={() => enter(c)}
                              className="flex flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-xs"
                              title="Ouvrir"
                            >
                              <Folder className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                              <span className="truncate">{c.name}</span>
                              {c.childCount > 0 && (
                                <span className="ml-auto text-[10px] text-muted-foreground">{c.childCount}</span>
                              )}
                              <ChevronRight className="h-3 w-3 text-muted-foreground" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>

                  {/* New folder + Pick current */}
                  <div className="flex flex-wrap items-center gap-2">
                    {creating ? (
                      <>
                        <Input
                          autoFocus
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder="Nom du nouveau dossier"
                          className="h-8 flex-1 text-xs"
                          onKeyDown={(e) => { if (e.key === "Enter") void createSubfolder(); }}
                        />
                        <Button size="sm" variant="outline" className="h-8" onClick={() => { setCreating(false); setNewName(""); }} disabled={busy === "newfolder"}>
                          Annuler
                        </Button>
                        <Button size="sm" className="h-8" onClick={createSubfolder} disabled={!newName.trim() || busy === "newfolder"}>
                          {busy === "newfolder" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                          Créer
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setCreating(true)} disabled={busy !== null}>
                          <FolderPlus className="mr-1 h-3.5 w-3.5" /> Nouveau dossier
                        </Button>
                        {currentId !== "root" && (
                          <Button
                            size="sm"
                            variant={picked?.id === currentId ? "default" : "secondary"}
                            className="h-8 text-xs"
                            onClick={() => setPicked({ id: currentId, path: currentPath })}
                          >
                            {picked?.id === currentId ? <Check className="mr-1 h-3.5 w-3.5" /> : null}
                            Choisir « {crumbs[crumbs.length - 1].name} »
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {targetLabel && (
            <div className="rounded-md bg-muted/40 px-3 py-1.5 text-xs">
              Destination : <span className="font-medium">{targetLabel}</span>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-6 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy !== null}>Annuler</Button>
          <Button onClick={uploadToOneDrive} disabled={!targetLabel || busy !== null}>
            {busy === "onedrive" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Cloud className="mr-2 h-4 w-4" />
            Envoyer dans OneDrive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
