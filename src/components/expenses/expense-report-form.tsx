import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Plus, Trash2, Paperclip, Mail, Save, Download, FileText, ArrowLeft, Sparkles, Eye, Send } from "lucide-react";
import { toast } from "sonner";
import {
  getReport, upsertReport, fillExpenseTemplate, listTemplates,
  DEFAULT_IDENTIFICATION, CATEGORIES, KM_RATE_2024, type ExpenseCategory,
} from "@/lib/expense.functions";
import { generateExpensePDFClient } from "./expense-pdf";
import { CATEGORY_META } from "./category-icons";
import { ImportFromEmailDialog, type ImportedItem } from "./import-from-email-dialog";
import { AIBatchExtractDialog, type AIExtractedLine } from "./ai-batch-extract-dialog";
import { ContactEmailAutocomplete } from "@/components/contacts/contact-email-autocomplete";
import { EmailComposer, type ComposerAccount, type ComposerAttachment, type ComposerInitial } from "@/components/inbox/email-composer";
import { getSignatureForAccount } from "@/lib/email-signatures";

// helper not exported by server-fns — local copy
type Item = {
  id?: string;
  date: string;
  category: ExpenseCategory;
  description: string;
  vendor: string | null;
  amount_ttc: number;
  tva_rate: number | null;
  amount_ht: number | null;
  km_distance: number | null;
  km_rate: number | null;
  has_receipt: boolean;
  receipt_path: string | null;
  receipt_document_id: string | null;
  source_email_id: string | null;
  position: number;
};

function emptyItem(pos: number): Item {
  return {
    date: new Date().toISOString().slice(0, 10),
    category: "transport_commun",
    description: "",
    vendor: "",
    amount_ttc: 0,
    tva_rate: 0,
    amount_ht: null,
    km_distance: null,
    km_rate: null,
    has_receipt: false,
    receipt_path: null,
    receipt_document_id: null,
    source_email_id: null,
    position: pos,
  };
}

function downloadBase64(filename: string, mime: string, b64: string) {
  const bin = atob(b64);
  const arr = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const blob = new Blob([arr], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function ExpenseReportForm({ reportId, userId, onBack, onSaved }: {
  reportId?: string; userId: string; onBack: () => void; onSaved: () => void;
}) {
  const getFn = useServerFn(getReport);
  const upsertFn = useServerFn(upsertReport);
  const fillFn = useServerFn(fillExpenseTemplate);
  const tplFn = useServerFn(listTemplates);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [aiBatchOpen, setAiBatchOpen] = useState(false);
  const [aiInitialFiles, setAiInitialFiles] = useState<File[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [pickedTpl, setPickedTpl] = useState<string>("");

  const [title, setTitle] = useState("");
  const [missionObject, setMissionObject] = useState("");
  const [missionDescription, setMissionDescription] = useState("");
  const [missionContext, setMissionContext] = useState<string>("");
  const [organization, setOrganization] = useState("");
  const [missionNumber, setMissionNumber] = useState("");
  const [ident, setIdent] = useState({ ...DEFAULT_IDENTIFICATION });
  const [items, setItems] = useState<Item[]>([]);
  const [advance, setAdvance] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<string>("virement");
  const [iban, setIban] = useState("");
  const [signatureLocation, setSignatureLocation] = useState("Bordeaux");
  const [signatureDate, setSignatureDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [status, setStatus] = useState<string>("draft");

  // Composer state
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerInitial, setComposerInitial] = useState<ComposerInitial>({ mode: "new" });
  const [composerAccounts, setComposerAccounts] = useState<ComposerAccount[]>([]);
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);

  // PDF preview state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);


  useEffect(() => {
    void tplFn().then((r) => setTemplates(r.templates));
    if (!reportId) {
      setTitle(`Note de frais — ${new Date().toLocaleDateString("fr-FR")}`);
      return;
    }
    setLoading(true);
    getFn({ data: { id: reportId } }).then((r) => {
      const rep = r.report;
      setTitle(rep.title);
      setMissionObject(rep.mission_object ?? "");
      setMissionDescription((rep as any).mission_description ?? "");
      setMissionContext(rep.mission_context ?? "");
      setOrganization(rep.organization ?? "");
      setMissionNumber(rep.mission_number ?? "");
      setIdent({ ...DEFAULT_IDENTIFICATION, ...((rep.identification ?? {}) as Record<string, string>) });
      setAdvance(Number(rep.advance_amount) || 0);
      setPaymentMethod(rep.payment_method ?? "virement");
      setIban(rep.iban ?? "");
      setSignatureLocation(rep.signature_location ?? "Bordeaux");
      setSignatureDate(rep.signature_date ?? new Date().toISOString().slice(0, 10));
      setNotes(rep.notes ?? "");
      setRecipientEmail((rep as any).recipient_email ?? "");
      setStatus(rep.status ?? "draft");
      setItems((r.items as any[]).map((it, idx) => ({
        id: it.id, date: it.date, category: it.category, description: it.description,
        vendor: it.vendor, amount_ttc: Number(it.amount_ttc), tva_rate: it.tva_rate != null ? Number(it.tva_rate) : 0,
        amount_ht: it.amount_ht != null ? Number(it.amount_ht) : null,
        km_distance: it.km_distance, km_rate: it.km_rate != null ? Number(it.km_rate) : null,
        has_receipt: it.has_receipt, receipt_path: it.receipt_path, receipt_document_id: it.receipt_document_id,
        source_email_id: it.source_email_id, position: idx,
      })));
    }).catch((e) => toast.error(e?.message ?? "Erreur")).finally(() => setLoading(false));
  }, [reportId]);

  const total = useMemo(() => items.reduce((s, it) => s + (Number(it.amount_ttc) || 0), 0), [items]);
  const toReimburse = Math.max(0, total - (Number(advance) || 0));

  const updateItem = (i: number, patch: Partial<Item>) => setItems((prev) => prev.map((it, idx) => {
    if (idx !== i) return it;
    const next = { ...it, ...patch };
    if (patch.category === "vehicule_perso" && next.km_rate == null) next.km_rate = KM_RATE_2024;
    if (next.category === "vehicule_perso" && (patch.km_distance != null || patch.km_rate != null)) {
      const d = Number(next.km_distance) || 0; const r = Number(next.km_rate) || KM_RATE_2024;
      next.amount_ttc = Math.round(d * r * 100) / 100;
    }
    if ((patch.amount_ttc != null || patch.tva_rate != null) && next.tva_rate != null && next.tva_rate > 0) {
      next.amount_ht = Math.round((next.amount_ttc / (1 + next.tva_rate / 100)) * 100) / 100;
    }
    return next;
  }));

  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const addItem = () => setItems((prev) => [...prev, emptyItem(prev.length)]);

  const onReceiptFile = async (i: number, file: File | null) => {
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { toast.error("Fichier > 6 Mo"); return; }
    const path = `${userId}/receipts/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error } = await supabase.storage.from("expense-receipts").upload(path, file, { contentType: file.type });
    if (error) { toast.error(error.message); return; }
    updateItem(i, { has_receipt: true, receipt_path: path });
    toast.success("Justificatif joint");
  };

  const onImportedFromEmail = (imp: ImportedItem) => {
    setItems((prev) => [...prev, {
      ...emptyItem(prev.length),
      date: imp.date, category: imp.category, description: imp.description,
      vendor: imp.vendor, amount_ttc: imp.amount_ttc, tva_rate: imp.tva_rate,
      source_email_id: imp.source_email_id,
    }]);
  };

  const onAIBatchLines = (lines: AIExtractedLine[]) => {
    setItems((prev) => {
      const base = prev.length;
      const additions = lines.map((l, i) => ({
        ...emptyItem(base + i),
        date: l.date,
        category: l.category,
        description: l.description,
        vendor: l.vendor,
        amount_ttc: l.amount_ttc,
        tva_rate: l.tva_rate,
        amount_ht: l.amount_ht,
        source_email_id: l.source_email_id,
      }));
      return [...prev, ...additions];
    });
  };


  const save = async (newStatus?: string): Promise<string | null> => {
    if (!title.trim()) { toast.error("Titre requis"); return null; }
    setSaving(true);
    try {
      const r = await upsertFn({ data: {
        id: reportId,
        title, mission_object: missionObject || null, mission_description: missionDescription || null,
        mission_context: (missionContext as any) || null,
        organization: organization || null, mission_number: missionNumber || null,
        identification: ident, status: (newStatus as any) ?? (status as any),
        advance_amount: advance, currency: "EUR",
        payment_method: (paymentMethod as any), iban: iban || null,
        signature_location: signatureLocation, signature_date: signatureDate || null,
        notes: notes || null,
        recipient_email: recipientEmail || null,
        items: items.map((it, idx) => ({ ...it, vendor: it.vendor ?? null, position: idx })),
      } });
      toast.success("Note enregistrée");
      onSaved();
      return r.id;
    } catch (e: any) { toast.error(e?.message ?? "Erreur"); return null; }
    finally { setSaving(false); }
  };

  const buildPdf = () => generateExpensePDFClient({
    title, missionObject, missionDescription, missionContext, organization, missionNumber, ident,
    items, total, advance, toReimburse,
    paymentMethod, iban, signatureLocation, signatureDate, notes,
  });

  const exportPDF = async () => {
    const id = await save(); if (!id) return;
    try {
      const out = buildPdf();
      downloadBase64(out.filename, "application/pdf", out.base64);
    } catch (e: any) { toast.error(e?.message ?? "Erreur PDF"); }
  };

  const previewPDF = () => {
    try {
      const out = buildPdf();
      const bin = atob(out.base64);
      const arr = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const blob = new Blob([arr], { type: "application/pdf" });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e: any) { toast.error(e?.message ?? "Erreur PDF"); }
  };

  const sendByMail = async () => {
    if (!recipientEmail.trim()) { toast.error("Renseigne un destinataire"); return; }
    const id = await save(); if (!id) return;
    try {
      const { data: accs } = await supabase
        .from("accounts")
        .select("id, name, type, color, icon, credentials")
        .eq("user_id", userId)
        .eq("is_active", true);
      const accounts = (accs ?? []) as ComposerAccount[];
      const sendable = accounts.filter((a) => ["gmail", "outlook", "imap"].includes(a.type));
      if (sendable.length === 0) { toast.error("Aucun compte mail configuré"); return; }
      const signature = getSignatureForAccount(sendable[0]);
      const body = [
        `Bonjour,`,
        ``,
        `Je vous adresse ma note de frais relative à : ${missionObject || title}.`,
        ``,
        `En vous souhaitant une bonne réception.`,
        ``,
        `Bien cordialement.`,
        ``,
        `-- `,
        signature,
      ].join("\n");
      const out = buildPdf();
      setComposerAccounts(accounts);
      setComposerAttachments([{ name: out.filename, type: "application/pdf", size: Math.ceil(out.base64.length * 0.75), contentBase64: out.base64 }]);
      setComposerInitial({
        mode: "new",
        to: recipientEmail.trim(),
        subject: `Note de frais — ${missionObject || title}`,
        body,
      });
      setComposerOpen(true);
      // Statut auto : marquer la note comme "envoyée" dès l'ouverture du composer
      try {
        await supabase.from("expense_reports").update({ sent_at: new Date().toISOString(), archived_at: null }).eq("id", id).eq("user_id", userId);
      } catch {}
    } catch (e: any) { toast.error(e?.message ?? "Erreur"); }
  };

  const fillTemplate = async () => {
    if (!pickedTpl) { toast.error("Choisis un modèle"); return; }
    const id = await save(); if (!id) return;
    try {
      const out = await fillFn({ data: { reportId: id, templateId: pickedTpl } });
      downloadBase64(out.filename, out.mime, out.base64);
    } catch (e: any) { toast.error(e?.message ?? "Erreur remplissage"); }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-3 border-b">
        <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1 font-medium text-sm truncate">{title || "Nouvelle note de frais"}</div>
        <Button size="sm" variant="outline" onClick={() => save()} disabled={saving} className="gap-1">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Enregistrer
        </Button>
        <Button size="sm" variant="outline" onClick={previewPDF} className="gap-1">
          <Eye className="h-3 w-3" /> Aperçu
        </Button>
        <Button size="sm" onClick={exportPDF} disabled={saving} className="gap-1">
          <FileText className="h-3 w-3" /> PDF
        </Button>
        <Button size="sm" variant="secondary" onClick={sendByMail} disabled={saving} className="gap-1">
          <Send className="h-3 w-3" /> Envoyer
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6 max-w-4xl mx-auto">
          {/* Identification */}
          <section>
            <h3 className="text-sm font-semibold mb-2">Identification</h3>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Nom</Label><Input value={ident.fullName} onChange={(e) => setIdent({ ...ident, fullName: e.target.value })} /></div>
              <div><Label className="text-xs">Titre / Fonction</Label><Input value={ident.title} onChange={(e) => setIdent({ ...ident, title: e.target.value })} /></div>
              <div><Label className="text-xs">Service / Unité</Label><Input value={ident.service} onChange={(e) => setIdent({ ...ident, service: e.target.value })} /></div>
              <div><Label className="text-xs">Établissement</Label><Input value={ident.institution} onChange={(e) => setIdent({ ...ident, institution: e.target.value })} /></div>
              <div><Label className="text-xs">Email pro</Label><Input value={ident.email} onChange={(e) => setIdent({ ...ident, email: e.target.value })} /></div>
              <div><Label className="text-xs">RPPS (optionnel)</Label><Input value={ident.rpps} onChange={(e) => setIdent({ ...ident, rpps: e.target.value })} /></div>
            </div>
          </section>

          {/* Mission */}
          <section>
            <h3 className="text-sm font-semibold mb-2">Objet de la mission</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2"><Label className="text-xs">Titre de la note</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="col-span-2"><Label className="text-xs">Intitulé de la mission</Label><Input value={missionObject} onChange={(e) => setMissionObject(e.target.value)} placeholder="Congrès SFC 2026 — Paris" /></div>
              <div className="col-span-2"><Label className="text-xs">Description de la mission et des frais</Label><Textarea value={missionDescription} onChange={(e) => setMissionDescription(e.target.value)} className="min-h-[80px]" placeholder="Contexte de la mission, nature des dépenses engagées…" /></div>
              <div>
                <Label className="text-xs">Cadre</Label>
                <Select value={missionContext} onValueChange={setMissionContext}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="congres">Congrès</SelectItem>
                    <SelectItem value="formation">Formation</SelectItem>
                    <SelectItem value="reunion">Réunion</SelectItem>
                    <SelectItem value="enseignement">Enseignement</SelectItem>
                    <SelectItem value="recherche">Recherche</SelectItem>
                    <SelectItem value="autre">Autre</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Organisme invitant</Label><Input value={organization} onChange={(e) => setOrganization(e.target.value)} /></div>
              <div><Label className="text-xs">N° mission / bon de commande</Label><Input value={missionNumber} onChange={(e) => setMissionNumber(e.target.value)} /></div>
            </div>
          </section>

          {/* Items */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Dépenses ({items.length})</h3>
              <div className="flex gap-1 flex-wrap items-center">
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  className="hidden"
                  id="ai-add-docs"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length === 0) return;
                    setAiInitialFiles(files);
                    setAiBatchOpen(true);
                    e.target.value = "";
                  }}
                />
                <label htmlFor="ai-add-docs">
                  <Button asChild size="sm" variant="outline" className="gap-1 h-7 text-xs">
                    <span><Paperclip className="h-3 w-3" /> Ajouter des documents</span>
                  </Button>
                </label>
                <Button size="sm" variant="default" onClick={() => { setAiInitialFiles([]); setAiBatchOpen(true); }} className="gap-1 h-7 text-xs">
                  <Sparkles className="h-3 w-3" /> Analyser par IA
                </Button>
                <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} className="gap-1 h-7 text-xs">
                  <Mail className="h-3 w-3" /> Depuis un email
                </Button>
                <Button size="sm" variant="ghost" onClick={addItem} className="gap-1 h-7 text-xs"><Plus className="h-3 w-3" /> Ligne</Button>
              </div>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="border rounded-md p-2 grid grid-cols-12 gap-1.5 items-start">
                  <Input className="col-span-2 h-8 text-xs" type="date" value={it.date} onChange={(e) => updateItem(i, { date: e.target.value })} />
                  <Select value={it.category} onValueChange={(v) => updateItem(i, { category: v as ExpenseCategory })}>
                    <SelectTrigger className="col-span-2 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (<SelectItem key={c} value={c}><span className="mr-1">{CATEGORY_META[c].icon}</span>{CATEGORY_META[c].label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  <Input className="col-span-3 h-8 text-xs" placeholder="Description" value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} />
                  {it.category === "vehicule_perso" ? (
                    <>
                      <Input className="col-span-1 h-8 text-xs" type="number" placeholder="km" value={it.km_distance ?? ""} onChange={(e) => updateItem(i, { km_distance: parseInt(e.target.value) || 0 })} />
                      <Input className="col-span-1 h-8 text-xs" type="number" step="0.001" placeholder="€/km" value={it.km_rate ?? KM_RATE_2024} onChange={(e) => updateItem(i, { km_rate: parseFloat(e.target.value) || KM_RATE_2024 })} />
                      <Input className="col-span-1 h-8 text-xs" type="number" step="0.01" value={it.amount_ttc} readOnly />
                    </>
                  ) : (
                    <>
                      <Input className="col-span-1 h-8 text-xs" type="number" step="0.01" placeholder="TTC" value={it.amount_ttc} onChange={(e) => updateItem(i, { amount_ttc: parseFloat(e.target.value) || 0 })} />
                      <Input className="col-span-1 h-8 text-xs" type="number" step="0.1" placeholder="TVA%" value={it.tva_rate ?? 0} onChange={(e) => updateItem(i, { tva_rate: parseFloat(e.target.value) || 0 })} />
                      <Input className="col-span-1 h-8 text-xs" type="number" step="0.01" placeholder="HT" value={it.amount_ht ?? ""} onChange={(e) => updateItem(i, { amount_ht: parseFloat(e.target.value) || null })} />
                    </>
                  )}
                  <div className="col-span-1">
                    <input type="file" accept="image/*,application/pdf" className="hidden" id={`rcpt-${i}`} onChange={(e) => onReceiptFile(i, e.target.files?.[0] ?? null)} />
                    <label htmlFor={`rcpt-${i}`}>
                      <Button asChild size="sm" variant={it.has_receipt ? "default" : "outline"} className="h-8 w-full p-0">
                        <span><Paperclip className="h-3 w-3" /></span>
                      </Button>
                    </label>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeItem(i)} className="col-span-1 h-8 w-8 p-0">
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}
              {items.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Aucune dépense — ajoute une ligne ou importe depuis un email.</p>}
            </div>
          </section>

          {/* Récap */}
          <section>
            <h3 className="text-sm font-semibold mb-2">Récapitulatif</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between border rounded p-2"><span>Total dépenses</span><strong>{total.toFixed(2)} €</strong></div>
              <div className="flex justify-between border rounded p-2 items-center"><span>Avances reçues</span>
                <Input type="number" step="0.01" value={advance} onChange={(e) => setAdvance(parseFloat(e.target.value) || 0)} className="h-7 w-24 text-right" />
              </div>
              <div className="flex justify-between border rounded p-2 col-span-2 bg-primary/5"><span>À rembourser</span><strong>{toReimburse.toFixed(2)} €</strong></div>
              <div>
                <Label className="text-xs">Mode de remboursement</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="virement">Virement</SelectItem>
                    <SelectItem value="cheque">Chèque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">IBAN</Label><Input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="FR76 …" /></div>
            </div>
          </section>

          {/* Signature */}
          <section>
            <h3 className="text-sm font-semibold mb-2">Signature</h3>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Lieu</Label><Input value={signatureLocation} onChange={(e) => setSignatureLocation(e.target.value)} /></div>
              <div><Label className="text-xs">Date</Label><Input type="date" value={signatureDate} onChange={(e) => setSignatureDate(e.target.value)} /></div>
              <div><Label className="text-xs">Nom</Label><Input value={ident.fullName} onChange={(e) => setIdent({ ...ident, fullName: e.target.value })} /></div>
            </div>
          </section>

          <section>
            <Label className="text-xs">Notes internes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px]" />
          </section>

          {/* Modèle */}
          {templates.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold mb-2">Remplir un modèle</h3>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label className="text-xs">Modèle</Label>
                  <Select value={pickedTpl} onValueChange={setPickedTpl}>
                    <SelectTrigger><SelectValue placeholder="Choisir un modèle" /></SelectTrigger>
                    <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} ({t.organization})</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button onClick={fillTemplate} disabled={!pickedTpl || saving} className="gap-1"><Download className="h-4 w-4" /> Remplir & télécharger</Button>
              </div>
            </section>
          )}

          <section>
            <h3 className="text-sm font-semibold mb-2">Destinataire de la note</h3>
            <Label className="text-xs">Email du destinataire</Label>
            <ContactEmailAutocomplete value={recipientEmail} onChange={setRecipientEmail} onSelect={setRecipientEmail} placeholder="ex: comptabilite@chu-bordeaux.fr" />
            <p className="text-xs text-muted-foreground mt-1">Recherche automatique dans vos contacts pendant la frappe.</p>
          </section>

          <section>
            <Label className="text-xs">Statut</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Brouillon</SelectItem>
                <SelectItem value="submitted">Soumise</SelectItem>
                <SelectItem value="approved">Approuvée</SelectItem>
                <SelectItem value="rejected">Rejetée</SelectItem>
                <SelectItem value="paid">Payée</SelectItem>
              </SelectContent>
            </Select>
          </section>
        </div>
      </ScrollArea>

      <ImportFromEmailDialog open={importOpen} onOpenChange={setImportOpen} onPick={onImportedFromEmail} />
      <AIBatchExtractDialog open={aiBatchOpen} onOpenChange={setAiBatchOpen} onLines={onAIBatchLines} initialFiles={aiInitialFiles} />
      <EmailComposer open={composerOpen} onOpenChange={setComposerOpen} accounts={composerAccounts} initial={composerInitial} initialAttachments={composerAttachments} />
      <Dialog open={!!previewUrl} onOpenChange={(o) => { if (!o) { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); } }}>
        <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-4 py-2 border-b">
            <DialogTitle className="text-sm">Aperçu PDF — {title || "Note de frais"}</DialogTitle>
          </DialogHeader>
          {previewUrl && <iframe src={previewUrl} className="flex-1 w-full" title="Aperçu PDF" />}
          <div className="flex justify-end gap-2 p-3 border-t">
            <Button variant="outline" onClick={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}>Fermer</Button>
            <Button onClick={() => { void exportPDF(); }} className="gap-1"><Download className="h-4 w-4" /> Enregistrer</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
