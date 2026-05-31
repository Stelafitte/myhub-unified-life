import { useEffect, useMemo, useState } from "react";
import { Loader2, Download, Cloud, Sparkles, Folder, Search, Check } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { type DocumentRow, getSignedUrl } from "@/lib/documents";
import { listOneDriveFolders, type OneDriveFolder } from "@/lib/api/onedrive.functions";
import { uploadFileToOneDrive } from "@/lib/api/onedrive-upload.functions";

type Props = {
  doc: DocumentRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context?: { fromAddress?: string | null; subject?: string | null };
};

const STOP = new Set(["le","la","les","un","une","des","de","du","et","ou","pour","par","avec","the","a","an","of","to","for","and","or","with","in","on","at","re","fwd","tr"]);
function tokens(s?: string | null): string[] {
  if (!s) return [];
  return s.toLowerCase().replace(/[^a-z0-9àâäéèêëïîôöùûüç\s]+/gi, " ").split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));
}

function scoreFolder(f: OneDriveFolder, ctx: Set<string>): { score: number; matches: string[] } {
  const ft = new Set(tokens(f.path.replace(/\//g, " ")));
  const matches: string[] = [];
  let s = 0;
  for (const t of ctx) {
    if (ft.has(t)) { s += 2; if (matches.length < 3) matches.push(t); }
  }
  // small bonus for shallower folders (more general → safer default)
  s -= f.depth * 0.1;
  return { score: s, matches };
}

export function DownloadOptionsDialog({ doc, open, onOpenChange, context }: Props) {
  const [loading, setLoading] = useState(false);
  const [folders, setFolders] = useState<OneDriveFolder[]>([]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<OneDriveFolder | null>(null);
  const [busy, setBusy] = useState<"local" | "onedrive" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadFn = useServerFn(uploadFileToOneDrive);
  const listFn = useServerFn(listOneDriveFolders);

  useEffect(() => {
    if (!open) return;
    setPicked(null); setQuery(""); setError(null);
    setLoading(true);
    listFn()
      .then((r) => setFolders(r.folders))
      .catch((e) => setError(e instanceof Error ? e.message : "OneDrive indisponible"))
      .finally(() => setLoading(false));
  }, [open, listFn]);

  const ctxTokens = useMemo(() => {
    if (!doc) return new Set<string>();
    return new Set([
      ...tokens(doc.original_filename),
      ...tokens(context?.subject),
      ...tokens((context?.fromAddress ?? "").split("@")[1]?.split(".")[0]),
    ]);
  }, [doc, context]);

  const ranked = useMemo(() => {
    return folders
      .map((f) => ({ f, ...scoreFolder(f, ctxTokens) }))
      .sort((a, b) => b.score - a.score);
  }, [folders, ctxTokens]);

  const suggestions = useMemo(() => ranked.filter((r) => r.score >= 2).slice(0, 3), [ranked]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? ranked.filter(({ f }) => f.path.toLowerCase().includes(q)) : ranked;
    return list.slice(0, 200);
  }, [ranked, query]);

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
    if (!doc?.storage_path || !picked) return;
    setBusy("onedrive");
    try {
      await uploadFn({ data: { storagePath: doc.storage_path, folderId: picked.id, filename: doc.original_filename } });
      toast.success(`Envoyé dans OneDrive › ${picked.path}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec OneDrive");
    } finally { setBusy(null); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Télécharger « {doc?.original_filename} »</DialogTitle>
          <DialogDescription>Choisis la destination du fichier.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Local downloads */}
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

            {loading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Chargement des dossiers…
              </div>
            ) : error ? (
              <div className="p-4 text-xs text-muted-foreground">{error}</div>
            ) : folders.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">Aucun dossier trouvé dans OneDrive.</div>
            ) : (
              <div className="space-y-3 p-3">
                {suggestions.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5 text-primary" /> Suggestions intelligentes
                    </div>
                    {suggestions.map(({ f, matches }) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setPicked(f)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors",
                          picked?.id === f.id ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                        )}
                      >
                        <Folder className="h-4 w-4 text-primary" />
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium">{f.path}</div>
                          {matches.length > 0 && (
                            <div className="text-xs text-muted-foreground">mots-clés: {matches.join(", ")}</div>
                          )}
                        </div>
                        {matches.length > 0 && <Badge variant="secondary" className="text-[10px]">{matches.length} match{matches.length > 1 ? "es" : ""}</Badge>}
                        {picked?.id === f.id && <Check className="h-4 w-4 text-primary" />}
                      </button>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">Sélection manuelle</div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Rechercher un dossier…"
                      className="h-8 pl-7 text-sm"
                    />
                  </div>
                  <ScrollArea className="h-40 rounded-md border">
                    <div className="p-1">
                      {filtered.map(({ f }) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setPicked(f)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/50",
                            picked?.id === f.id && "bg-primary/10 text-primary",
                          )}
                          style={{ paddingLeft: `${0.5 + f.depth * 0.75}rem` }}
                        >
                          <Folder className="h-3 w-3 shrink-0" />
                          <span className="truncate">{f.name}</span>
                          <span className="ml-auto truncate text-[10px] text-muted-foreground">{f.path}</span>
                        </button>
                      ))}
                      {filtered.length === 0 && (
                        <div className="px-2 py-3 text-center text-xs text-muted-foreground">Aucun dossier</div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy !== null}>Annuler</Button>
          <Button onClick={uploadToOneDrive} disabled={!picked || busy !== null}>
            {busy === "onedrive" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Cloud className="mr-2 h-4 w-4" />
            Envoyer dans OneDrive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
