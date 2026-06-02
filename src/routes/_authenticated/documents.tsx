import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FolderOpen, Mail, CheckSquare, CalendarClock, Folder, Search, Lock, Trash2, Eye, Link as LinkIcon, Loader2, Filter, X, CheckCircle2, Cloud, Sparkles, Wand2, ChevronRight, ChevronDown } from "lucide-react";
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
import { DownloadOptionsDialog } from "@/components/inbox/download-options-dialog";
import { type DocumentRow, getSignedUrl, removeFromStorage } from "@/lib/documents";
import { deleteSecureBlob } from "@/lib/secure-documents";
import { useServerFn } from "@tanstack/react-start";
import { classifyPendingDocuments } from "@/lib/api/document-classify.functions";




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
  | { kind: "sensitive" }
  | { kind: "saved" }
  | { kind: "unsaved" };


type TypeFilter = "all" | FileCategory;
type DateFilter = "all" | "today" | "week" | "month";
type SizeFilter = "all" | "heavy";
type AiFilter = "all" | "unclassified" | "signature" | "facture" | "contrat" | "rapport" | "presentation" | "courrier" | "rh" | "technique" | "image" | "autre";

const AI_CATEGORY_META: Record<string, { label: string; cls: string }> = {
  facture: { label: "Facture", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  contrat: { label: "Contrat", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  rapport: { label: "Rapport", cls: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300" },
  presentation: { label: "Présentation", cls: "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300" },
  courrier: { label: "Courrier", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
  rh: { label: "RH", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  technique: { label: "Technique", cls: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200" },
  image: { label: "Image", cls: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-300" },
  signature: { label: "Signature", cls: "bg-muted text-muted-foreground" },
  autre: { label: "Autre", cls: "bg-muted text-muted-foreground" },
};

function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<SourceFilter>({ kind: "all" });
  const [typeF, setTypeF] = useState<TypeFilter>("all");
  const [dateF, setDateF] = useState<DateFilter>("all");
  const [sizeF, setSizeF] = useState<SizeFilter>("all");
  const [aiF, setAiF] = useState<AiFilter>("all");
  const [minSizeKb, setMinSizeKb] = useState<number>(30);
  const [classifying, setClassifying] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<DocumentRow | null>(null);
  const [saveTarget, setSaveTarget] = useState<DocumentRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const runClassify = useServerFn(classifyPendingDocuments);



  async function load() {
    setLoading(true);
    const [d, a, s] = await Promise.all([
      supabase.from("documents").select("*").order("created_at", { ascending: false }),
      supabase.from("accounts").select("id,name").order("name"),
      supabase.from("document_retention_settings").select("ai_min_size_kb").maybeSingle(),
    ]);
    setDocs((d.data as DocumentRow[]) ?? []);
    setAccounts((a.data as Account[]) ?? []);
    if (s.data?.ai_min_size_kb != null) setMinSizeKb(s.data.ai_min_size_kb);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function saveMinSize(v: number) {
    const clamped = Math.max(0, Math.min(10000, Math.round(v)));
    setMinSizeKb(clamped);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("document_retention_settings").upsert(
      { user_id: user.id, ai_min_size_kb: clamped },
      { onConflict: "user_id" },
    );
  }

  async function classifyNow() {
    if (classifying) return;
    setClassifying(true);
    try {
      const res = await runClassify();
      if ("error" in res && res.error) {
        toast.error(res.error);
      } else {
        const p = (res as { processed?: number }).processed ?? 0;
        const sk = (res as { skipped?: number }).skipped ?? 0;
        if (p === 0 && sk === 0) toast.info("Aucun document à classer");
        else toast.success(`${p} classé(s) par IA, ${sk} ignoré(s)`);
        await load();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec classification");
    } finally {
      setClassifying(false);
    }
  }


  const counts = useMemo(() => {
    const c = { all: docs.length, email: 0, task: 0, meeting: 0, manual: 0, sensitive: 0, saved: 0, unsaved: 0 } as Record<string, number>;
    for (const d of docs) {
      c[d.source_type] = (c[d.source_type] ?? 0) + 1;
      if (d.is_sensitive) c.sensitive += 1;
      if (d.onedrive_item_id) c.saved += 1; else c.unsaved += 1;
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
      if (source.kind === "sensitive" && !d.is_sensitive) return false;
      if (source.kind === "saved" && !d.onedrive_item_id) return false;
      if (source.kind === "unsaved" && d.onedrive_item_id) return false;
      if (source.kind !== "all" && source.kind !== "sensitive" && source.kind !== "saved" && source.kind !== "unsaved") {
        if (d.source_type !== source.kind) return false;
        if (source.kind === "email" && source.accountId && d.account_id !== source.accountId) return false;
      }

      if (typeF !== "all" && categorize(d.mime_type, d.filename) !== typeF) return false;
      if (dateF !== "all") {
        const age = now - new Date(d.created_at).getTime();
        const lim = dateF === "today" ? dayMs : dateF === "week" ? 7 * dayMs : 30 * dayMs;
        if (age > lim) return false;
      }
      if (sizeF === "heavy" && d.file_size < 5 * 1024 * 1024) return false;
      if (aiF !== "all") {
        if (aiF === "unclassified") {
          if (d.ai_processed_at) return false;
        } else if ((d.ai_category ?? "") !== aiF) return false;
      }

      if (search) {
        const q = search.toLowerCase();
        if (!d.filename.toLowerCase().includes(q) && !(d.description ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [docs, source, typeF, dateF, sizeF, aiF, search]);

  const grouped = useMemo(() => {
    const order = ["facture","contrat","rapport","presentation","courrier","rh","technique","image","autre","signature","__unclassified"] as const;
    const map = new Map<string, DocumentRow[]>();
    for (const d of filtered) {
      const key = d.ai_processed_at ? (d.ai_category ?? "autre") : "__unclassified";
      const arr = map.get(key) ?? [];
      arr.push(d);
      map.set(key, arr);
    }
    return order
      .filter((k) => map.has(k))
      .map((k) => ({ key: k as string, docs: map.get(k as string)! }));
  }, [filtered]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (k: string) => setCollapsedGroups((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allCollapsed = grouped.length > 0 && grouped.every((g) => collapsedGroups.has(g.key));
  const toggleAllGroups = () => {
    setCollapsedGroups(allCollapsed ? new Set() : new Set(grouped.map((g) => g.key)));
  };

  async function applyMinSizeRule() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await saveMinSize(minSizeKb);
    const minBytes = minSizeKb * 1024;
    const now = new Date().toISOString();
    try {
      const smallDocs = docs.filter((d) => d.file_size < minBytes);
      const smallImages = smallDocs.filter((d) => (d.mime_type ?? "").startsWith("image/")).map((d) => d.id);
      const smallOther = smallDocs.filter((d) => !(d.mime_type ?? "").startsWith("image/")).map((d) => d.id);
      if (smallImages.length > 0) {
        await supabase.from("documents").update({
          ai_processed_at: now, ai_category: "signature", ai_priority: "low",
          ai_summary: `Fichier < ${minSizeKb} Ko — ignoré`, ai_skipped_reason: "small_file",
        }).in("id", smallImages);
      }
      if (smallOther.length > 0) {
        await supabase.from("documents").update({
          ai_processed_at: now, ai_category: "autre", ai_priority: "low",
          ai_summary: `Fichier < ${minSizeKb} Ko — ignoré`, ai_skipped_reason: "small_file",
        }).in("id", smallOther);
      }
      const reEligible = docs.filter((d) => d.ai_skipped_reason === "small_file" && d.file_size >= minBytes).map((d) => d.id);
      if (reEligible.length > 0) {
        await supabase.from("documents").update({
          ai_processed_at: null, ai_category: null, ai_priority: null,
          ai_summary: null, ai_skipped_reason: null,
        }).in("id", reEligible);
      }
      const total = smallImages.length + smallOther.length + reEligible.length;
      toast.success(total > 0 ? `Règle appliquée — ${total} document(s) mis à jour` : "Règle appliquée");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'application");
    }
  }

  const selectionMode = selected.size > 0;
  const allFilteredSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());
  const selectAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filtered.forEach((d) => next.delete(d.id));
      } else {
        filtered.forEach((d) => next.add(d.id));
      }
      return next;
    });
  };

  async function performDelete(targets: DocumentRow[]) {
    const errs: string[] = [];
    for (const d of targets) {
      try {
        if (d.local_only) await deleteSecureBlob(d.id);
        else if (d.storage_path) await removeFromStorage(d.storage_path);
        const { error } = await supabase.from("documents").delete().eq("id", d.id);
        if (error) throw error;
      } catch (e) {
        errs.push(d.filename);
        console.error("delete fail", d.filename, e);
      }
    }
    if (errs.length === 0) toast.success(targets.length > 1 ? `${targets.length} documents supprimés` : "Supprimé");
    else toast.error(`${errs.length} échec(s) sur ${targets.length}`);
  }

  async function deleteDoc(d: DocumentRow) {
    if (!confirm(`Supprimer "${d.filename}" ?`)) return;
    await performDelete([d]);
    load();
  }

  async function bulkDelete() {
    const targets = docs.filter((d) => selected.has(d.id));
    if (targets.length === 0) return;
    if (!confirm(`Supprimer ${targets.length} document(s) ?`)) return;
    await performDelete(targets);
    clearSelection();
    load();
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
    <div className="flex h-[calc(100vh-3.5rem)] relative">
      {/* Sidebar */}
      <aside className={cn(
        "absolute inset-y-0 left-0 z-20 w-64 border-r bg-muted/20 flex flex-col transition-transform md:relative md:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-3 border-b">
          <Button className="w-full" size="sm" onClick={() => setUploadOpen(true)}>＋ Ajouter un document</Button>
          <p className="text-xs text-muted-foreground mt-2">{docs.length} fichiers · {formatBytes(totalSize)}</p>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5 text-sm">
            <TreeItem icon={Folder} label="Tous" count={counts.all} active={source.kind === "all"} onClick={() => { setSource({ kind: "all" }); setSidebarOpen(false); }} />
            <TreeItem icon={Mail} label="Emails" count={counts.email} active={source.kind === "email" && !source.accountId} onClick={() => { setSource({ kind: "email" }); setSidebarOpen(false); }} />
            {source.kind === "email" && (
              <div className="ml-5 space-y-0.5">
                {accounts.map((a) => (
                  <TreeItem key={a.id} label={a.name} count={emailsByAccount.get(a.id) ?? 0} active={source.kind === "email" && source.accountId === a.id} onClick={() => { setSource({ kind: "email", accountId: a.id }); setSidebarOpen(false); }} small />
                ))}
                {(emailsByAccount.get("none") ?? 0) > 0 && (
                  <TreeItem label="Sans compte" count={emailsByAccount.get("none") ?? 0} onClick={() => {}} small />
                )}
              </div>
            )}
            <TreeItem icon={CheckSquare} label="Tâches" count={counts.task} active={source.kind === "task"} onClick={() => { setSource({ kind: "task" }); setSidebarOpen(false); }} />
            <TreeItem icon={CalendarClock} label="Réunions" count={counts.meeting} active={source.kind === "meeting"} onClick={() => { setSource({ kind: "meeting" }); setSidebarOpen(false); }} />
            <TreeItem icon={FolderOpen} label="Manuel" count={counts.manual} active={source.kind === "manual"} onClick={() => { setSource({ kind: "manual" }); setSidebarOpen(false); }} />
            <TreeItem icon={Lock} label="Sensibles" count={counts.sensitive} active={source.kind === "sensitive"} onClick={() => { setSource({ kind: "sensitive" }); setSidebarOpen(false); }} className="text-red-600" />
            <TreeItem icon={Cloud} label="Enregistrés OneDrive" count={counts.saved} active={source.kind === "saved"} onClick={() => { setSource({ kind: "saved" }); setSidebarOpen(false); }} className="text-emerald-600" />
            <TreeItem icon={Sparkles} label="À classer" count={counts.unsaved} active={source.kind === "unsaved"} onClick={() => { setSource({ kind: "unsaved" }); setSidebarOpen(false); }} className="text-amber-600" />


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
              <FilterGroup label="Catégorie IA">
                <FilterChip active={aiF === "all"} onClick={() => setAiF("all")}>Toutes</FilterChip>
                <FilterChip active={aiF === "unclassified"} onClick={() => setAiF("unclassified")}>Non classés</FilterChip>
                {(["facture","contrat","rapport","presentation","courrier","rh","technique","image","signature","autre"] as const).map((k) => (
                  <FilterChip key={k} active={aiF === k} onClick={() => setAiF(k)}>{AI_CATEGORY_META[k]?.label ?? k}</FilterChip>
                ))}
              </FilterGroup>
              <div className="mt-2 px-1">
                <label className="text-[10px] uppercase text-muted-foreground block mb-1">Ignorer fichiers &lt;</label>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={0}
                    value={minSizeKb}
                    onChange={(e) => setMinSizeKb(Number(e.target.value))}
                    onBlur={(e) => saveMinSize(Number(e.target.value))}
                    className="h-7 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">Ko</span>
                </div>
                <Button size="sm" variant="secondary" className="mt-1.5 w-full h-7 text-xs" onClick={applyMinSizeRule}>
                  Appliquer la règle
                </Button>
                <p className="text-[10px] text-muted-foreground mt-1">S'applique à tous les fichiers (signatures, logos, fragments…).</p>
              </div>
            </div>

          </div>
        </ScrollArea>
      </aside>

      {sidebarOpen && (
        <div className="absolute inset-0 z-10 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-4 border-b flex items-center gap-2">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(true)}>
            <Filter className="h-4 w-4" />
          </Button>
          <div className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" className="pl-9" />
          </div>
          {!selectionMode && (
            <Button variant="outline" size="sm" onClick={classifyNow} disabled={classifying} className="gap-1.5">
              {classifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Classer IA</span>
            </Button>
          )}
          {!selectionMode && grouped.length > 0 && (
            <Button variant="outline" size="sm" onClick={toggleAllGroups} className="gap-1.5">
              {allCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{allCollapsed ? "Tout déplier" : "Tout replier"}</span>
            </Button>
          )}
          {!selectionMode && filtered.length > 0 && (
            <Button variant="outline" size="sm" onClick={selectAllFiltered} className="hidden sm:inline-flex">
              Sélectionner
            </Button>
          )}

        </div>

        {/* Selection toolbar */}
        {selectionMode && (
          <div className="flex items-center gap-2 border-b bg-primary/5 px-3 py-2">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={clearSelection} aria-label="Annuler">
              <X className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium">{selected.size} sélectionné{selected.size > 1 ? "s" : ""}</span>
            <Button size="sm" variant="ghost" onClick={selectAllFiltered} className="gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              {allFilteredSelected ? "Tout désélectionner" : "Tout"}
            </Button>
            <div className="ml-auto flex gap-1">
              {selected.size === 1 && (
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => {
                  const d = docs.find((x) => selected.has(x.id));
                  if (d) copyLink(d);
                }}>
                  <LinkIcon className="h-3.5 w-3.5" /> Lien
                </Button>
              )}
              <Button size="sm" variant="destructive" onClick={bulkDelete} className="gap-1.5">
                <Trash2 className="h-3.5 w-3.5" /> Supprimer
              </Button>
            </div>
          </div>
        )}

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
            ) : (
              <div className="space-y-4">
                {grouped.map(({ key, docs: groupDocs }) => {
                  const meta = key === "__unclassified"
                    ? { label: "Non classés", cls: "bg-muted text-muted-foreground" }
                    : (AI_CATEGORY_META[key] ?? { label: key, cls: "bg-muted text-muted-foreground" });
                  const collapsed = collapsedGroups.has(key);
                  return (
                    <div key={key}>
                      <button
                        onClick={() => toggleGroup(key)}
                        className="sticky top-0 z-10 w-full flex min-w-0 cursor-pointer items-center gap-2 border-b bg-primary/15 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary backdrop-blur hover:bg-primary/20 rounded-sm mb-1"
                      >
                        {collapsed ? (
                          <ChevronRight className="h-3 w-3 text-primary" />
                        ) : (
                          <ChevronDown className="h-3 w-3 text-primary" />
                        )}
                        <Sparkles className="h-3 w-3 text-primary" />
                        <span className="truncate">{meta.label}</span>
                        <span className="ml-auto text-[10px] font-normal">{groupDocs.length}</span>
                      </button>
                      {!collapsed && (
                        <div className="space-y-1">
                          {groupDocs.map((d) => (
                            <DocRow
                              key={d.id}
                              doc={d}
                              selectionMode={selectionMode}
                              selected={selected.has(d.id)}
                              onToggleSelect={() => toggleSelect(d.id)}
                              onPreview={() => selectionMode ? toggleSelect(d.id) : setPreview(d)}
                              onDelete={() => deleteDoc(d)}
                              onCopy={() => copyLink(d)}
                              onSaveToOneDrive={() => setSaveTarget(d)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <UploadDocumentDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={load} />
      <DocumentPreviewSheet doc={preview} onOpenChange={(o) => !o && setPreview(null)} />
      <DownloadOptionsDialog
        doc={saveTarget}
        open={!!saveTarget}
        onOpenChange={(o) => { if (!o) { setSaveTarget(null); load(); } }}
      />

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

const SWIPE_REVEAL = 160; // px wide actions panel
const SWIPE_THRESHOLD = 80;

function DocRow({
  doc,
  selectionMode,
  selected,
  onToggleSelect,
  onPreview,
  onDelete,
  onCopy,
  onSaveToOneDrive,
}: {
  doc: DocumentRow;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onPreview: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onSaveToOneDrive: () => void;
}) {

  const cat = categorize(doc.mime_type, doc.filename);
  const Icon = iconFor(cat);
  const src = sourceLabel(doc.source_type);

  const [dragX, setDragX] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const startRef = useRef<{ x: number; y: number; t: number; locked: "h" | "v" | null } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLongPress = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY, t: Date.now(), locked: null };
    if (!selectionMode) {
      clearLongPress();
      longPressTimer.current = setTimeout(() => {
        onToggleSelect();
        startRef.current = null;
        if (navigator.vibrate) navigator.vibrate(10);
      }, 500);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = startRef.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (s.locked === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        s.locked = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
        if (s.locked === "h") clearLongPress();
        else { clearLongPress(); startRef.current = null; return; }
      } else return;
    }
    if (s.locked === "h") {
      clearLongPress();
      // Allow swipe left to reveal; allow swipe right to close if open
      const base = revealed ? -SWIPE_REVEAL : 0;
      let nx = base + dx;
      if (nx > 0) nx = 0;
      if (nx < -SWIPE_REVEAL) nx = -SWIPE_REVEAL - (Math.abs(nx + SWIPE_REVEAL) * 0.2);
      setDragX(nx);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    clearLongPress();
    const s = startRef.current;
    startRef.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const dt = Date.now() - s.t;
    if (s.locked === "h") {
      const opening = dragX <= -SWIPE_THRESHOLD;
      setRevealed(opening);
      setDragX(opening ? -SWIPE_REVEAL : 0);
      return;
    }
    // Treat as tap
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6 && dt < 500) {
      if (revealed) { setRevealed(false); setDragX(0); return; }
      onPreview();
    }
  };
  const onPointerCancel = () => {
    clearLongPress();
    startRef.current = null;
    setDragX(revealed ? -SWIPE_REVEAL : 0);
  };

  const closeReveal = () => { setRevealed(false); setDragX(0); };

  return (
    <div className={cn(
      "group relative overflow-hidden rounded border-b last:border-b-0 select-none",
      selected && "bg-primary/10",
    )}>
      {/* Swipe actions (behind) */}
      <div className="absolute inset-y-0 right-0 flex items-stretch" style={{ width: SWIPE_REVEAL }}>
        <button
          onClick={() => { closeReveal(); onCopy(); }}
          className="flex-1 bg-blue-500 text-white text-xs font-medium flex flex-col items-center justify-center gap-1"
          aria-label="Copier lien"
        >
          <LinkIcon className="h-4 w-4" />
          Lien
        </button>
        <button
          onClick={() => { closeReveal(); onDelete(); }}
          className="flex-1 bg-red-600 text-white text-xs font-medium flex flex-col items-center justify-center gap-1"
          aria-label="Supprimer"
        >
          <Trash2 className="h-4 w-4" />
          Suppr.
        </button>
      </div>

      <div
        className={cn(
          "relative flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 py-3 bg-background",
          !selected && "hover:bg-muted/50",
          selected && "bg-primary/10",
          startRef.current?.locked === "h" ? "" : "transition-transform duration-200",
        )}
        style={{ transform: `translateX(${dragX}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {selectionMode ? (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                "h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center",
                selected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40",
              )}
              aria-label={selected ? "Désélectionner" : "Sélectionner"}
            >
              {selected && <CheckCircle2 className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <Icon className={cn("h-6 w-6 shrink-0", colorFor(cat))} />
          )}
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-medium truncate">{doc.filename}</p>
            <p className="text-xs text-muted-foreground">{formatBytes(doc.file_size)} · {format(new Date(doc.created_at), "d MMM yyyy HH:mm", { locale: fr })}</p>
            {doc.ai_summary && <p className="text-xs text-muted-foreground/80 truncate italic mt-0.5">{doc.ai_summary}</p>}
          </div>

        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", src.cls)}>{src.label}</span>
          {doc.ai_category && AI_CATEGORY_META[doc.ai_category] && (
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full gap-0.5 inline-flex items-center", AI_CATEGORY_META[doc.ai_category].cls)}>
              <Sparkles className="h-2.5 w-2.5" />{AI_CATEGORY_META[doc.ai_category].label}
            </span>
          )}
          {doc.is_sensitive && <Badge variant="destructive" className="text-[10px] gap-0.5"><Lock className="h-2.5 w-2.5" />Sensible</Badge>}
          {doc.onedrive_item_id ? (
            doc.onedrive_web_url ? (
              <a
                href={doc.onedrive_web_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300"
                title={doc.onedrive_folder_path ?? "Enregistré sur OneDrive"}
              >
                <Cloud className="h-2.5 w-2.5" /> Enregistré
              </a>
            ) : (
              <Badge variant="secondary" className="text-[10px] gap-0.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                <Cloud className="h-2.5 w-2.5" /> Enregistré
              </Badge>
            )
          ) : null}
          {doc.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {doc.tags.slice(0, 3).map((t) => <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{t}</span>)}
            </div>
          )}
          <div className="hidden sm:flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button size="icon" variant="ghost" className="h-7 w-7" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onPreview(); }} title="Aperçu"><Eye className="h-3.5 w-3.5" /></Button>
            {doc.storage_path && !doc.local_only && (
              <Button
                size="icon"
                variant="ghost"
                className={cn("h-7 w-7", doc.onedrive_item_id ? "text-emerald-600" : "text-sky-600")}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onSaveToOneDrive(); }}
                title={doc.onedrive_item_id ? "Re-enregistrer sur OneDrive (IA)" : "Classer avec IA → OneDrive"}
              >
                <Cloud className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button size="icon" variant="ghost" className="h-7 w-7" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onCopy(); }} title="Copier le lien"><LinkIcon className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Supprimer"><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        </div>

      </div>
    </div>
  );
}
