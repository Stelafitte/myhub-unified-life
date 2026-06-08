import { useState, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Plus, Trash2, Paperclip, X, Download, RefreshCw, Receipt } from "lucide-react";
import { toast } from "sonner";
import { generateExpenseReport, type ExpenseItem } from "@/lib/api/expense-report.functions";

type LocalAtt = { name: string; mime: string; size: number; dataBase64: string; blob: Blob };

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function ExpenseReportDialog({
  open,
  onOpenChange,
  emailIds,
  initialInstruction,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  emailIds: string[];
  initialInstruction?: string;
}) {
  const expenseFn = useServerFn(generateExpenseReport);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [instruction, setInstruction] = useState(initialInstruction ?? "");
  const [attachments, setAttachments] = useState<LocalAtt[]>([]);
  const [analyzed, setAnalyzed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ranOnce = useRef(false);

  useEffect(() => {
    if (!open) {
      ranOnce.current = false;
      setItems([]); setTitle(""); setNotes(""); setAttachments([]); setAnalyzed(false);
      setInstruction(initialInstruction ?? "");
      return;
    }
    if (open && !ranOnce.current && emailIds.length > 0) {
      ranOnce.current = true;
      void analyze(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const analyze = async (initial = false) => {
    setLoading(true);
    try {
      const atts = attachments.map(a => ({ name: a.name, mime: a.mime, dataBase64: a.dataBase64 }));
      const res = await expenseFn({ data: { emailIds, instruction: instruction || null, attachments: atts } });
      setItems(res.items);
      setNotes(res.notes);
      setCurrency(res.currency);
      if (initial || !title) setTitle(res.title);
      setAnalyzed(true);
      toast.success(initial ? `${res.items.length} ligne(s) détectée(s)` : "Note régénérée");
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const addLine = () => setItems(prev => [...prev, {
    date: new Date().toISOString().slice(0, 10),
    description: "", category: "Autre", vendor: "", reference: "",
    amount_ttc: 0, amount_ht: null, tva: null, currency, source_email_id: null,
  }]);

  const updateItem = (i: number, patch: Partial<ExpenseItem>) =>
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));

  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: LocalAtt[] = [];
    for (const f of Array.from(files).slice(0, 10 - attachments.length)) {
      if (f.size > 6 * 1024 * 1024) { toast.error(`${f.name} > 6 Mo, ignoré`); continue; }
      const b64 = await fileToBase64(f);
      next.push({ name: f.name, mime: f.type || "application/octet-stream", size: f.size, dataBase64: b64, blob: f });
    }
    setAttachments(prev => [...prev, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const total = items.reduce((s, it) => s + (Number(it.amount_ttc) || 0), 0);

  const downloadZip = async () => {
    if (items.length === 0) { toast.error("Aucune ligne à exporter"); return; }
    setLoading(true);
    try {
      const [{ jsPDF }, JSZipMod] = await Promise.all([
        import("jspdf"),
        import("jszip"),
      ]);
      const JSZip = (JSZipMod as any).default ?? JSZipMod;

      // CSV
      const header = ["Date", "Description", "Catégorie", "Fournisseur", "Référence", "Montant HT", "TVA", "Montant TTC", "Devise"];
      const esc = (v: unknown) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [header.join(";"), ...items.map(it => [
        it.date ?? "", it.description, it.category, it.vendor, it.reference,
        it.amount_ht ?? "", it.tva ?? "", it.amount_ttc, it.currency,
      ].map(esc).join(";"))].join("\n");

      // PDF récap + images en annexe
      const doc = new jsPDF();
      let y = 18;
      doc.setFontSize(16); doc.text(title || "Note de frais", 14, y); y += 8;
      doc.setFontSize(10); doc.setTextColor(100);
      doc.text(`Généré le ${new Date().toLocaleDateString("fr-FR")} · ${items.length} ligne(s)`, 14, y); y += 8;
      doc.setTextColor(0); doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text("Date", 14, y); doc.text("Description", 38, y); doc.text("Fournisseur", 110, y);
      doc.text("Montant TTC", 196, y, { align: "right" }); y += 2;
      doc.line(14, y, 196, y); y += 5;
      doc.setFont("helvetica", "normal");
      for (const it of items) {
        if (y > 275) { doc.addPage(); y = 18; }
        doc.text(it.date ?? "—", 14, y);
        const desc = doc.splitTextToSize(it.description || "", 70);
        doc.text(desc, 38, y);
        doc.text((it.vendor || "").slice(0, 30), 110, y);
        doc.text(`${Number(it.amount_ttc).toFixed(2)} ${it.currency}`, 196, y, { align: "right" });
        y += Math.max(5, desc.length * 4);
      }
      y += 4; doc.line(14, y, 196, y); y += 6;
      doc.setFont("helvetica", "bold");
      doc.text(`Total : ${total.toFixed(2)} ${currency}`, 196, y, { align: "right" });
      if (notes) {
        y += 10; doc.setFont("helvetica", "italic"); doc.setFontSize(8);
        const n = doc.splitTextToSize("Notes IA : " + notes, 180);
        doc.text(n, 14, y);
      }
      // Annexe images
      const imgAtts = attachments.filter(a => a.mime.startsWith("image/"));
      const otherAtts = attachments.filter(a => !a.mime.startsWith("image/"));
      if (imgAtts.length > 0) {
        doc.addPage(); doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(0);
        doc.text("Pièces jointes (images)", 14, 18);
        for (const att of imgAtts) {
          try {
            doc.addPage();
            doc.setFontSize(9); doc.setFont("helvetica", "italic"); doc.text(att.name, 14, 12);
            const fmt = att.mime.includes("png") ? "PNG" : att.mime.includes("webp") ? "WEBP" : "JPEG";
            doc.addImage(`data:${att.mime};base64,${att.dataBase64}`, fmt, 14, 16, 180, 250, undefined, "FAST");
          } catch { /* skip */ }
        }
      }
      if (otherAtts.length > 0) {
        doc.addPage(); doc.setFontSize(14); doc.setFont("helvetica", "bold");
        doc.text("Autres pièces jointes (dans le ZIP)", 14, 18);
        doc.setFontSize(10); doc.setFont("helvetica", "normal");
        let yy = 28;
        for (const a of otherAtts) { doc.text(`• ${a.name}`, 14, yy); yy += 6; }
      }

      const pdfBlob = doc.output("blob");

      // ZIP
      const zip = new JSZip();
      const safeTitle = (title || "Note de frais").replace(/[^\w\- ]+/g, "_");
      zip.file(`${safeTitle}.pdf`, pdfBlob);
      zip.file(`${safeTitle}.csv`, "\uFEFF" + csv);
      if (attachments.length > 0) {
        const folder = zip.folder("pieces-jointes");
        for (const a of attachments) folder?.file(a.name, a.blob);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${safeTitle}.zip`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success("ZIP téléchargé");
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur export");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" /> Note de frais
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Titre</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Note de frais — Mai 2026" />
            </div>

            {loading && !analyzed && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Analyse des emails par l'IA…
              </div>
            )}

            {analyzed && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs">Lignes de dépenses ({items.length})</Label>
                  <Button size="sm" variant="ghost" onClick={addLine} className="h-7 text-xs gap-1">
                    <Plus className="h-3 w-3" /> Ajouter
                  </Button>
                </div>
                <div className="space-y-2">
                  {items.map((it, i) => (
                    <div key={i} className="grid grid-cols-12 gap-1.5 items-start border rounded-md p-2">
                      <Input className="col-span-3 h-8 text-xs" type="date" value={it.date ?? ""} onChange={(e) => updateItem(i, { date: e.target.value || null })} />
                      <Input className="col-span-5 h-8 text-xs" placeholder="Description" value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} />
                      <Input className="col-span-2 h-8 text-xs" placeholder="Fournisseur" value={it.vendor} onChange={(e) => updateItem(i, { vendor: e.target.value })} />
                      <Input className="col-span-1 h-8 text-xs" type="number" step="0.01" value={it.amount_ttc} onChange={(e) => updateItem(i, { amount_ttc: parseFloat(e.target.value) || 0 })} />
                      <Button size="sm" variant="ghost" onClick={() => removeItem(i)} className="col-span-1 h-8 w-8 p-0">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  {items.length === 0 && <p className="text-xs text-muted-foreground text-center py-3">Aucune ligne. Ajoutez manuellement ou re-analysez avec des PJ.</p>}
                </div>
                <div className="flex justify-end pt-2 text-sm font-semibold">
                  Total : {total.toFixed(2)} {currency}
                </div>
              </div>
            )}

            <div>
              <Label className="text-xs">Instructions / contexte supplémentaire pour l'IA</Label>
              <Textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="ex: Mission DIU Lyon 12-14 mai. Ignore le mail de remboursement."
                className="min-h-[60px] text-sm"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" /> Pièces jointes ({attachments.length}/10)</Label>
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={attachments.length >= 10} className="h-7 text-xs">
                  <Plus className="h-3 w-3 mr-1" /> Ajouter PJ
                </Button>
                <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => onFiles(e.target.files)} />
              </div>
              {attachments.length > 0 && (
                <div className="space-y-1">
                  {attachments.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs bg-muted/40 rounded px-2 py-1">
                      <Paperclip className="h-3 w-3 shrink-0" />
                      <span className="flex-1 truncate">{a.name}</span>
                      <span className="text-muted-foreground">{(a.size / 1024).toFixed(0)} Ko</span>
                      <span className="text-muted-foreground text-[10px]">{a.mime.startsWith("image/") ? "lu par IA" : "joint au ZIP"}</span>
                      <Button size="sm" variant="ghost" onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))} className="h-6 w-6 p-0">
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {notes && (
              <div className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2">
                ℹ️ {notes}
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => analyze(false)} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Re-analyser{attachments.length > 0 ? " avec PJ" : ""}
          </Button>
          <Button onClick={downloadZip} disabled={loading || items.length === 0} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> Télécharger ZIP
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
