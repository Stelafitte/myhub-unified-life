import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { listExpenseEmailCandidates, extractExpenseFromEmail, type ExpenseCategory } from "@/lib/expense.functions";

export type ImportedItem = {
  date: string;
  category: ExpenseCategory;
  description: string;
  vendor: string;
  amount_ttc: number;
  tva_rate: number | null;
  source_email_id: string | null;
};

export function ImportFromEmailDialog({
  open, onOpenChange, onPick,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onPick: (item: ImportedItem) => void;
}) {
  const listFn = useServerFn(listExpenseEmailCandidates);
  const extractFn = useServerFn(extractExpenseFromEmail);
  const [search, setSearch] = useState("");
  const [emails, setEmails] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [extractingId, setExtractingId] = useState<string | null>(null);

  const load = async (s?: string) => {
    setLoading(true);
    try {
      const r = await listFn({ data: { search: s || undefined } });
      setEmails(r.emails);
    } catch (e: any) { toast.error(e?.message ?? "Erreur"); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (open) void load(); }, [open]);

  const handlePick = async (emailId: string) => {
    setExtractingId(emailId);
    try {
      const r = await extractFn({ data: { emailId } });
      const e = r.extracted;
      onPick({
        date: e.date ?? new Date().toISOString().slice(0, 10),
        category: e.category,
        description: e.description || "(à compléter)",
        vendor: e.vendor,
        amount_ttc: e.amount_ttc,
        tva_rate: e.tva_rate ?? null,
        source_email_id: r.source_email_id,
      });
      toast.success("Ligne pré-remplie — vérifie avant validation");
      onOpenChange(false);
    } catch (e: any) { toast.error(e?.message ?? "Erreur extraction"); }
    finally { setExtractingId(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader><DialogTitle>📧 Importer une dépense depuis un email</DialogTitle></DialogHeader>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher facture, hôtel, SNCF..." className="pl-8" onKeyDown={(e) => e.key === "Enter" && load(search)} />
          </div>
          <Button onClick={() => load(search)} disabled={loading} variant="outline">Filtrer</Button>
        </div>
        <ScrollArea className="flex-1 -mx-6 px-6">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : emails.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">Aucun email trouvé</p>
          ) : (
            <div className="space-y-1">
              {emails.map((em) => (
                <div key={em.id} className="border rounded-md p-2 hover:bg-muted/40 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{em.subject || "(sans objet)"}</p>
                    <p className="text-xs text-muted-foreground truncate">{em.from_name || em.from_address} · {em.received_at ? new Date(em.received_at).toLocaleDateString("fr-FR") : ""}</p>
                  </div>
                  <Button size="sm" onClick={() => handlePick(em.id)} disabled={!!extractingId} className="gap-1">
                    {extractingId === em.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Extraire
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
