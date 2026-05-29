import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FolderOpen, Mail, CheckSquare, CalendarClock, Folder, Search, LayoutGrid, List, Lock, Trash2, Eye, Link as LinkIcon, Loader2, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { categorize, iconFor, colorFor, formatBytes, sourceLabel, type FileCategory } from "@/lib/file-icons";
import { UploadDocumentDialog } from "@/components/documents/upload-document-dialog";
import { DocumentPreviewSheet } from "@/components/documents/document-preview-sheet";
import { type DocumentRow, getSignedUrl, removeFromStorage } from "@/lib/documents";
import { deleteSecureBlob } from "@/lib/secure-documents";

export const Route = createFileRoute("/_authenticated/documents")({
  component: DocumentsPage,
});

type Account = { id: string; name: string };

type SourceFilter =
  | { kind: "all" }
  | { kind: "email"; accountId?: string }
  | { kind: "task" }
  | { kind: "meeting" }
  | { kind: "manual" }
  | { kind: "sensitive" };

type TypeFilter = "all" | FileCategory;
type DateFilter = "all" | "today" | "week" | "month";
type SizeFilter = "all" | "heavy";

function DocumentsPage() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<SourceFilter>({ kind: "all" });
  const [typeF, setTypeF] = useState<TypeFilter>("all");
  const [dateF, setDateF] = useState<DateFilter>("all");
  const [sizeF, setSizeF] = useState<SizeFilter>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<DocumentRow | null>(null);

  async function load() {
    setLoading(true);
    const [d, a] = await Promise.all([
      supabase.from("documents").select("*").order("created_at", { ascending: false }),
      supabase.from("accounts").select("id,name").order("name"),
    ]);
    setDocs((d.data as DocumentRow[]) ?? []);
    setAccounts((a.data as Account[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c = { all: docs.length, email: 0, task: 0, meeting: 0, manual: 0, sensitive: 0 } as Record<string, number>;
    for (const d of docs) {
      c[d.source_type] = (c[d.source_type] ?? 0) + 1;
      if (d.is_sensitive) c.sensitive += 1;
    }
    return c;
  }, [docs]);

  const emailsByAccount = useMemo(() => {
    const m = new Map<string | "none", number>();
    docs.filter((d) => d.source_type === "email").forEach((d) => {
      const k = d.account_id ?? "none";
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return m;
  }, [docs]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const dayMs = 86400000;
    return docs.filter((d) => {
      // source
      if (source.kind === "sensitive" && !d.is_sensitive) return false;
      if (source.kind !== "all" && source.kind !== "sensitive") {
        if (d.source_type !== source.kind) return false;
        if (source.kind === "email" && source.accountId && d.account_id !== source.accountId) return false;
      }
      // type
      if (typeF !== "all" && categorize(d.mime_type, d.filename) !== typeF) return false;
      // date
      if (dateF !== "all") {
        const age = now - new Date(d.created_at).getTime();
        const lim = dateF === "today" ? dayMs : dateF === "week" ? 7 * dayMs : 30 * dayMs;
        if (age > lim) return false;
      }
      // size
      if (sizeF === "heavy" && d.file_size < 5 * 1024 * 1024) return false;
      // search
      if (search) {
        const q = search.toLowerCase();
        if (!d.filename.toLowerCase().includes(q) && !(d.description ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [docs, source, typeF, dateF, sizeF, search]);

  async function deleteDoc(d: DocumentRow) {
    if (!confirm(`Supprimer "${d.filename}" ?`)) return;
    try {
      if (d.local_only) await deleteSecureBlob(d.id);
      else if (d.storage_path) await removeFromStorage(d.storage_path);
      const { error } = await supabase.from("documents").delete().eq("id", d.id);
      if (error) throw error;
      toast.success("Supprimé");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    }
  }

  async function copyLink(d: DocumentRow) {
    if (d.local_only) { toast.error("Document local chiffré — non partageable"); return; }
    if (!d.storage_path) return;
    try {
      const url = await getSignedUrl(d.storage_path, 3600);
      await navigator.clipboard.writeText(url);
      toast.success("Lien copié (valide 1h)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    }
  }

  const totalSize = docs.reduce((s, d) => s + (d.file_size ?? 0), 0);

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Sidebar arborescence */}
      <aside className="w-64 border-r bg-muted/20 flex flex-col">
        <div className="p-3 border-b">
          <Button className="w-full" size="sm" onClick={() => setUploadOpen(true)}>＋ Ajouter un document</Button>
          <p className="text-xs text-muted-foreground mt-2">{docs.length} fichiers · {formatBytes(totalSize)}</p>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5 text-sm">
            <TreeItem icon={Folder} label="Tous" count={counts.all} active={source.kind === "all"} onClick={() => setSource({ kind: "all" })} />

            <TreeItem icon={Mail} label="Emails" count={counts.email} active={source.kind === "email" && !source.accountId} onClick={() => setSource({ kind: "email" })} />
            {source.kind === "email" && (
              <div className="ml-5 space-y-0.5">
                {accounts.map((a) => (
                  <TreeItem key={a.id} label={a.name} count={emailsByAccount.get(a.id) ?? 0} active={source.kind === "email" && source.accountId === a.id} onClick={() => setSource({ kind: "email", accountId: a.id })} small />
                ))}
                {(emailsByAccount.get("none") ?? 0) > 0 && (
                  <TreeItem label="Sans compte" count={emailsByAccount.get("none") ?? 0} onClick={() => {}} small />
                )}
              </div>
            )}

            <TreeItem icon={CheckSquare} label="Tâches" count={counts.task} active={source.kind === "task"} onClick={() => setSource({ kind: "task" })} />
            <TreeItem icon={CalendarClock} label="Réunions" count={counts.meeting} active={source.kind === "meeting"} onClick={() => setSource({ kind: "meeting" })} />
            <TreeItem icon={FolderOpen} label="Manuel" count={counts.manual} active={source.kind === "manual"} onClick={() => setSource({ kind: "manual" })} />
            <TreeItem icon={Lock} label="Sensibles" count={counts.sensitive} active={source.kind === "sensitive"} onClick={() => setSource({ kind: "sensitive" })} className="text-red-600" />

            <div className="pt-3 mt-3 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1"><Filter className="h-3 w-3" /> Filtres</p>

              <FilterGroup label="Type">
                {(["all","pdf","word","excel","image","other"] as const).map((t) => (
                  <FilterChip key={t} active={typeF === t} onClick={() => setTypeF(t)}>{t === "all" ? "Tous" : t.toUpperCase()}</FilterChip>
                ))}
              </FilterGroup>

              <FilterGroup label="Date">
                {([["all","Toutes"],["today","Aujourd'hui"],["week","Semaine"],["month","Mois"]] as const).map(([k, l]) => (
                  <FilterChip key={k} active={dateF === k} onClick={() => setDateF(k)}>{l}</FilterChip>
                ))}
              </FilterGroup>

              <FilterGroup label="Taille">
                <FilterChip active={sizeF === "all"} onClick={() => setSizeF("all")}>Toutes</FilterChip>
                <FilterChip active={sizeF === "heavy"} onClick={() => setSizeF("heavy")}>{`> 5 Mo`}</FilterChip>
              </FilterGroup>
            </div>
          </div>
        </ScrollArea>
      </aside>

      {/* Right pane */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-4 border-b flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" className="pl-9" />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button variant={view === "grid" ? "secondary" : "ghost"} size="icon" onClick={() => setView("grid")}><LayoutGrid className="h-4 w-4" /></Button>
            <Button variant={view === "list" ? "secondary" : "ghost"} size="icon" onClick={() => setView("list")}><List className="h-4 w-4" /></Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Chargement…
              </div>
            ) : filtered.length === 0 ? (
              <Card className="p-12 text-center text-muted-foreground">
                <FolderOpen className="h-10 w-10 mx-auto mb-2 opacity-40" />
                Aucun document.
              </Card>
            ) : view === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filtered.map((d) => <DocCard key={d.id} doc={d} onPreview={() => setPreview(d)} onDelete={() => deleteDoc(d)} onCopy={() => copyLink(d)} />)}
              </div>
            ) : (
              <div className="space-y-1">
                {filtered.map((d) => <DocRow key={d.id} doc={d} onPreview={() => setPreview(d)} onDelete={() => deleteDoc(d)} onCopy={() => copyLink(d)} />)}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <UploadDocumentDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={load} />
      <DocumentPreviewSheet doc={preview} onOpenChange={(o) => !o && setPreview(null)} />
    </div>
  );
}

function TreeItem({ icon: Icon, label, count, active, onClick, small, className }: { icon?: React.ComponentType<{ className?: string }>; label: string; count?: number; active?: boolean; onClick: () => void; small?: boolean; className?: string }) {
  return (
    <button onClick={onClick} className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted transition-colors", active && "bg-muted font-medium", small && "py-1 text-xs", className)}>
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      <span className="flex-1 text-left truncate">{label}</span>
      {count !== undefined && count > 0 && <span className="text-xs text-muted-foreground">{count}</span>}
    </button>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <p className="text-[10px] uppercase text-muted-foreground mb-1 px-1">{label}</p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("text-xs px-2 py-0.5 rounded border", active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted")}>
      {children}
    </button>
  );
}

function DocCard({ doc, onPreview, onDelete, onCopy }: { doc: DocumentRow; onPreview: () => void; onDelete: () => void; onCopy: () => void }) {
  const cat = categorize(doc.mime_type, doc.filename);
  const Icon = iconFor(cat);
  const src = sourceLabel(doc.source_type);
  return (
    <Card className="p-3 hover:shadow-md transition-shadow group flex flex-col">
      <button onClick={onPreview} className="flex items-center justify-center h-20 bg-muted/40 rounded mb-2 hover:bg-muted">
        <Icon className={cn("h-10 w-10", colorFor(cat))} />
      </button>
      <button onClick={onPreview} className="text-sm font-medium truncate text-left hover:underline" title={doc.filename}>{doc.filename}</button>
      <div className="flex items-center gap-1 mt-1 flex-wrap">
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", src.cls)}>{src.label}</span>
        {doc.is_sensitive && <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4 gap-0.5"><Lock className="h-2.5 w-2.5" /></Badge>}
      </div>
      <p className="text-xs text-muted-foreground mt-1">{formatBytes(doc.file_size)} · {format(new Date(doc.created_at), "d MMM", { locale: fr })}</p>
      {doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-0.5 mt-1">
          {doc.tags.slice(0, 2).map((t) => <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{t}</span>)}
        </div>
      )}
      <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onPreview}><Eye className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onCopy}><LinkIcon className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-6 w-6 text-red-600 ml-auto" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    </Card>
  );
}

function DocRow({ doc, onPreview, onDelete, onCopy }: { doc: DocumentRow; onPreview: () => void; onDelete: () => void; onCopy: () => void }) {
  const cat = categorize(doc.mime_type, doc.filename);
  const Icon = iconFor(cat);
  const src = sourceLabel(doc.source_type);
  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 rounded group">
      <Icon className={cn("h-5 w-5 shrink-0", colorFor(cat))} />
      <button onClick={onPreview} className="flex-1 min-w-0 text-left">
        <p className="text-sm font-medium truncate">{doc.filename}</p>
        <p className="text-xs text-muted-foreground">{formatBytes(doc.file_size)} · {format(new Date(doc.created_at), "d MMM yyyy HH:mm", { locale: fr })}</p>
      </button>
      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", src.cls)}>{src.label}</span>
      {doc.is_sensitive && <Badge variant="destructive" className="text-[10px] gap-0.5"><Lock className="h-2.5 w-2.5" />Sensible</Badge>}
      <div className="flex gap-1 opacity-0 group-hover:opacity-100">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onPreview}><Eye className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onCopy}><LinkIcon className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}
