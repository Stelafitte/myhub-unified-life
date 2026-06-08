import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Search, Sparkles, Paperclip, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  listExpenseEmailCandidates,
  mapLegacyCategoryToStructured,
  type ExpenseCategory,
} from "@/lib/expense.functions";
import { generateExpenseReport } from "@/lib/api/expense-report.functions";

export type AIExtractedLine = {
  date: string;
  category: ExpenseCategory;
  description: string;
  vendor: string | null;
  amount_ttc: number;
  tva_rate: number | null;
  amount_ht: number | null;
  source_email_id: string | null;
};

type LocalAtt = { name: string; mime: string; size: number; dataBase64: string };

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function AIBatchExtractDialog({
  open, onOpenChange, onLines,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onLines: (lines: AIExtractedLine[]) => void;
}) {
  const listFn = useServerFn(listExpenseEmailCandidates);
  const genFn = useServerFn(generateExpenseReport);
  const [search, setSearch] = useState("");
  const [emails, setEmails] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [instruction, setInstruction] = useState("");
  const [attachments, setAttachments] = useState<LocalAtt[]>([]);
  const [extracting, setExtracting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async (s?: string) => {
    setLoading(true);
    try {
      const r = await listFn({ data: { search: s || undefined } });
      setEmails(r.emails);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (open) {
      void load();
      setPicked(new Set());
      setAttachments([]);
      setInstruction("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: LocalAtt[] = [];
    for (const f of Array.from(files).slice(0, 10 - attachments.length)) {
      if (f.size > 6 * 1024 * 1024) { toast.error(`${f.name} > 6 Mo, ignoré`); continue; }
      const b64 = await fileToBase64(f);
      next.push({ name: f.name, mime: f.type || "application/octet-stream", size: f.size, dataBase64: b64 });
    }
    setAttachments((p) => [...p, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const run = async () => {
    if (picked.size === 0 && attachments.length === 0) {
      toast.error("Sélectionne au moins un email ou ajoute une pièce jointe");
      return;
    }
    setExtracting(true);
    try {
      const r = await genFn({
        data: {
          emailIds: Array.from(picked),
          instruction: instruction || null,
          attachments: attachments.map((a) => ({ name: a.name, mime: a.mime, dataBase64: a.dataBase64 })),
        },
      });
      const lines: AIExtractedLine[] = r.items.map((it) => {
        const tvaRate = it.amount_ht && it.tva ? Math.round((Number(it.tva) / Number(it.amount_ht)) * 1000) / 10 : 0;
        return {
          date: it.date && /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? it.date : new Date().toISOString().slice(0, 10),
          category: mapLegacyCategoryToStructured(it.category),
          description: it.description,
          vendor: it.vendor || null,
          amount_ttc: Number(it.amount_ttc) || 0,
          tva_rate: tvaRate,
          amount_ht: it.amount_ht != null ? Number(it.amount_ht) : null,
          source_email_id: it.source_email_id ?? null,
        };
      });
      onLines(lines);
      toast.success(`${lines.length} ligne(s) ajoutée(s)`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur IA");
    } finally {
      setExtracting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Analyser plusieurs emails / PJ par IA
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 flex-1 flex flex-col min-h-0">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher facture, hôtel, SNCF…"
                className="pl-8 h-8 text-sm"
                onKeyDown={(e) => e.key === "Enter" && load(search)}
              />
            </div>
            <Button onClick={() => load(search)} disabled={loading} variant="outline" size="sm">Filtrer</Button>
          </div>
          <ScrollArea className="flex-1 border rounded-md">
            {loading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin" /></div>
            ) : emails.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-6">Aucun email trouvé</p>
            ) : (
              <div className="divide-y">
                {emails.map((em) => (
                  <label key={em.id} className="flex items-start gap-2 p-2 hover:bg-muted/40 cursor-pointer text-sm">
                    <Checkbox checked={picked.has(em.id)} onCheckedChange={() => togglePick(em.id)} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{em.subject || "(sans objet)"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {em.from_name || em.from_address} · {em.received_at ? new Date(em.received_at).toLocaleDateString("fr-FR") : ""}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </ScrollArea>
          <div className="text-xs text-muted-foreground">{picked.size} email(s) sélectionné(s)</div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium flex items-center gap-1.5">
                <Paperclip className="h-3 w-3" /> Pièces jointes (reçus / billets) {attachments.length}/10
              </span>
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={attachments.length >= 10} className="h-7 text-xs gap-1">
                <Plus className="h-3 w-3" /> Ajouter
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
                    <Button size="sm" variant="ghost" onClick={() => setAttachments((p) => p.filter((_, idx) => idx !== i))} className="h-6 w-6 p-0">
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Instruction (optionnel) — ex: Mission DIU Lyon 12-14 mai"
            className="h-8 text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={extracting}>Annuler</Button>
          <Button onClick={run} disabled={extracting} className="gap-1.5">
            {extracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Extraire et ajouter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
