import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Plus, Receipt, Trash2, Upload, Sparkles, FileText, Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { listReports, deleteReport, listTemplates, deleteTemplate, analyzeExpenseTemplate, toggleArchiveReport } from "@/lib/expense.functions";
import { ExpenseReportForm } from "@/components/expenses/expense-report-form";
import { TemplateUploadDialog } from "@/components/expenses/template-upload-dialog";

type ExpensesSearch = { reportId?: string };

export const Route = createFileRoute("/_authenticated/expenses")({
  component: ExpensesPage,
  validateSearch: (s: Record<string, unknown>): ExpensesSearch => ({
    reportId: typeof s.reportId === "string" ? s.reportId : undefined,
  }),
});

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Brouillon", variant: "outline" },
  submitted: { label: "Soumise", variant: "secondary" },
  approved: { label: "Approuvée", variant: "default" },
  rejected: { label: "Rejetée", variant: "destructive" },
  paid: { label: "Payée", variant: "default" },
};

function ExpensesPage() {
  const { user } = useAuth();
  const search = useSearch({ from: "/_authenticated/expenses" }) as ExpensesSearch;
  const listFn = useServerFn(listReports);
  const delFn = useServerFn(deleteReport);
  const tplFn = useServerFn(listTemplates);
  const tplDelFn = useServerFn(deleteTemplate);
  const tplAnalyzeFn = useServerFn(analyzeExpenseTemplate);

  const [reports, setReports] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined); // undefined = list view, null = new, string = edit
  const [tplOpen, setTplOpen] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const [r, t] = await Promise.all([listFn(), tplFn()]);
      setReports(r.reports); setTemplates(t.templates);
    } catch (e: any) { toast.error(e?.message ?? "Erreur"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, []);

  // Auto-open a report when navigated with ?reportId=... (e.g. from AI mail dialog).
  useEffect(() => {
    if (search.reportId) setEditingId(search.reportId);
  }, [search.reportId]);


  const remove = async (id: string) => {
    if (!confirm("Supprimer cette note de frais ?")) return;
    await delFn({ data: { id } });
    toast.success("Supprimée");
    void reload();
  };
  const removeTpl = async (id: string) => {
    if (!confirm("Supprimer ce modèle ?")) return;
    await tplDelFn({ data: { id } });
    void reload();
  };
  const analyze = async (id: string) => {
    setAnalyzingId(id);
    try { await tplAnalyzeFn({ data: { id } }); toast.success("Modèle analysé"); void reload(); }
    catch (e: any) { toast.error(e?.message ?? "Erreur"); }
    finally { setAnalyzingId(null); }
  };

  if (!user) return null;

  if (editingId !== undefined) {
    return (
      <div className="h-[calc(100vh-3.5rem)]">
        <ExpenseReportForm
          reportId={editingId ?? undefined}
          userId={user.id}
          onBack={() => { setEditingId(undefined); void reload(); }}
          onSaved={() => void reload()}
        />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Receipt className="h-5 w-5" /> Notes de frais</h1>
          <p className="text-xs text-muted-foreground">Crée, suis, exporte et fais remplir tes modèles d'organisation.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTplOpen(true)} className="gap-1"><Upload className="h-4 w-4" /> Modèle</Button>
          <Button onClick={() => setEditingId(null)} className="gap-1"><Plus className="h-4 w-4" /> Nouvelle note</Button>
        </div>
      </div>

      <Tabs defaultValue="reports">
        <TabsList>
          <TabsTrigger value="reports">Notes ({reports.length})</TabsTrigger>
          <TabsTrigger value="templates">Modèles ({templates.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="space-y-2">
          {loading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
            : reports.length === 0 ? <p className="text-center text-sm text-muted-foreground py-8">Aucune note de frais — clique sur « Nouvelle note ».</p>
            : reports.map((r) => {
              const s = STATUS_LABEL[r.status] ?? STATUS_LABEL.draft;
              return (
                <Card key={r.id} className="p-3 flex items-center gap-3 cursor-pointer hover:bg-muted/40" onClick={() => setEditingId(r.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{r.title}</p>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{r.mission_object || r.organization || "—"} · {new Date(r.created_at).toLocaleDateString("fr-FR")}</p>
                  </div>
                  <div className="text-right text-sm">
                    <div className="font-semibold">{Number(r.total_amount).toFixed(2)} €</div>
                    <div className="text-xs text-muted-foreground">à rembourser : {Number(r.amount_to_reimburse).toFixed(2)} €</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); void remove(r.id); }} className="h-8 w-8 p-0">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </Card>
              );
            })}
        </TabsContent>

        <TabsContent value="templates" className="space-y-2">
          {templates.length === 0 ? <p className="text-center text-sm text-muted-foreground py-8">Aucun modèle — clique sur « Modèle » pour en importer un.</p>
            : templates.map((t) => (
              <Card key={t.id} className="p-3 flex items-center gap-3">
                <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.organization} · {t.file_type}{t.ai_mapping && Object.keys(t.ai_mapping).length > 0 ? " · analysé" : ""}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => analyze(t.id)} disabled={analyzingId === t.id} className="gap-1">
                  {analyzingId === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Analyser
                </Button>
                <Button size="sm" variant="ghost" onClick={() => removeTpl(t.id)} className="h-8 w-8 p-0"><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </Card>
            ))}
        </TabsContent>
      </Tabs>

      <TemplateUploadDialog open={tplOpen} onOpenChange={setTplOpen} onCreated={reload} userId={user.id} />
    </div>
  );
}
