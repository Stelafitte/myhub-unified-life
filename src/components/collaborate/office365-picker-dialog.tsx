import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listOneDriveItems,
  linkOffice365Document,
  resolveOneDriveShareLink,
} from "@/lib/collab-office365.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Folder,
  FileText,
  ChevronLeft,
  Search as SearchIcon,
  FileSpreadsheet,
  FilePieChart,
  Link2,
  ExternalLink,
  Plus,
  Info,
} from "lucide-react";
import { toast } from "sonner";

interface DriveItem {
  id: string;
  name: string;
  webUrl: string | null;
  isFolder: boolean;
  mimeType: string | null;
  size: number | null;
  modifiedAt: string | null;
  thumbnail: string | null;
}

function iconFor(item: DriveItem) {
  if (item.isFolder) return <Folder className="h-5 w-5 text-amber-500" />;
  const mt = item.mimeType ?? "";
  if (mt.includes("sheet") || item.name.endsWith(".xlsx"))
    return <FileSpreadsheet className="h-5 w-5 text-emerald-600" />;
  if (mt.includes("presentation") || item.name.endsWith(".pptx"))
    return <FilePieChart className="h-5 w-5 text-orange-600" />;
  return <FileText className="h-5 w-5 text-blue-600" />;
}

export function Office365PickerDialog({
  spaceId,
  open,
  onOpenChange,
  onLinked,
}: {
  spaceId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onLinked?: () => void;
}) {
  const listFn = useServerFn(listOneDriveItems);
  const linkFn = useServerFn(linkOffice365Document);
  const resolveFn = useServerFn(resolveOneDriveShareLink);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stack, setStack] = useState<{ id?: string; name: string }[]>([
    { name: "OneDrive" },
  ]);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [resolved, setResolved] = useState<DriveItem | null>(null);

  const isUrl = /^https?:\/\//i.test(search.trim());
  const current = stack[stack.length - 1];

  const load = async (folderId?: string, q?: string) => {
    setResolved(null);
    setLoading(true);
    setErr(null);
    try {
      const res = await listFn({
        data: { folderId, search: q && q.trim().length > 0 ? q : undefined },
      });
      setItems(res.items as DriveItem[]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setStack([{ name: "OneDrive" }]);
      setSearch("");
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const enterFolder = (item: DriveItem) => {
    setStack((s) => [...s, { id: item.id, name: item.name }]);
    setSearch("");
    load(item.id);
  };

  const goBack = () => {
    if (stack.length <= 1) return;
    const next = stack.slice(0, -1);
    setStack(next);
    setSearch("");
    load(next[next.length - 1].id);
  };

  const runSearch = async () => {
    await load(undefined, search);
  };

  const linkItem = async (item: DriveItem) => {
    if (!item.webUrl) {
      toast.error("Pas d'URL Office 365 disponible pour ce fichier.");
      return;
    }
    setLinkingId(item.id);
    try {
      await linkFn({
        data: {
          spaceId,
          itemId: item.id,
          name: item.name,
          webUrl: item.webUrl,
          thumbnailUrl: item.thumbnail,
        },
      });
      toast.success(`« ${item.name} » lié à l'espace`);
      onOpenChange(false);
      onLinked?.();
    } catch (e) {
      toast.error("Liaison échouée", { description: (e as Error).message });
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lier un fichier Office 365</DialogTitle>
          <DialogDescription>
            Parcours ton OneDrive et lie un document Word, Excel ou PowerPoint à
            cet espace.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={goBack}
            disabled={stack.length <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-sm font-medium truncate">
            {stack.map((s) => s.name).join(" / ")}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher dans OneDrive…"
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch();
            }}
          />
          <Button variant="outline" size="sm" onClick={runSearch}>
            <SearchIcon className="h-4 w-4" />
          </Button>
        </div>

        {err && (
          <div className="text-sm text-destructive border border-destructive/40 rounded-md p-3">
            {err}
          </div>
        )}

        <div className="max-h-[55vh] overflow-y-auto border rounded-md divide-y">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Chargement…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              Aucun fichier.
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40"
              >
                {iconFor(item)}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{item.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.modifiedAt
                      ? new Date(item.modifiedAt).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : ""}
                    {item.size ? ` · ${Math.round(item.size / 1024)} Ko` : ""}
                  </div>
                </div>
                {item.isFolder ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => enterFolder(item)}
                  >
                    Ouvrir
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => linkItem(item)}
                    disabled={linkingId === item.id || !item.webUrl}
                  >
                    {linkingId === item.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Lier"
                    )}
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
