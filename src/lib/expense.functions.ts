import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ============== Constants & types ==============

export const KM_RATE_2024 = 0.426; // €/km < 5000 km, véhicule 5CV (simplifié)

export const CATEGORIES = [
  "transport_commun",
  "vehicule_perso",
  "hebergement",
  "repas",
  "inscription",
  "documentation",
  "reprographie",
  "materiel",
  "telephone",
  "visa",
  "autre",
] as const;
export type ExpenseCategory = (typeof CATEGORIES)[number];

export const DEFAULT_IDENTIFICATION = {
  fullName: "Dr Stéphane LAFITTE",
  title: "PU-PH, Cardiologue",
  service: "UMCV — Unité Médico-Chirurgicale Vasculaire",
  institution: "CHU de Bordeaux",
  email: "",
  rpps: "",
};

// ============== Schemas ==============

const IdSchema = z.object({ id: z.string().uuid() });

const ItemInput = z.object({
  id: z.string().uuid().optional(),
  date: z.string(), // YYYY-MM-DD
  category: z.enum(CATEGORIES),
  description: z.string().max(500),
  vendor: z.string().max(255).nullable().optional().default(null),
  amount_ttc: z.number(),
  tva_rate: z.number().nullable().optional().default(0),
  amount_ht: z.number().nullable().optional().default(null),
  km_distance: z.number().int().nullable().optional().default(null),
  km_rate: z.number().nullable().optional().default(null),
  has_receipt: z.boolean().default(false),
  receipt_path: z.string().nullable().optional().default(null),
  receipt_document_id: z.string().uuid().nullable().optional().default(null),
  source_email_id: z.string().uuid().nullable().optional().default(null),
  position: z.number().int().default(0),
});

const ReportUpsert = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(255),
  mission_object: z.string().max(500).nullable().optional().default(null),
  mission_description: z.string().max(4000).nullable().optional().default(null),
  mission_context: z.enum(["congres", "formation", "reunion", "enseignement", "recherche", "autre"]).nullable().optional().default(null),
  organization: z.string().max(255).nullable().optional().default(null),
  mission_number: z.string().max(100).nullable().optional().default(null),
  identification: z.record(z.string(), z.any()).default({}),
  status: z.enum(["draft", "submitted", "approved", "rejected", "paid"]).default("draft"),
  advance_amount: z.number().default(0),
  currency: z.string().max(8).default("EUR"),
  payment_method: z.enum(["virement", "cheque"]).nullable().optional().default(null),
  iban: z.string().max(50).nullable().optional().default(null),
  signature_location: z.string().max(100).default("Bordeaux"),
  signature_date: z.string().nullable().optional().default(null),
  notes: z.string().max(4000).nullable().optional().default(null),
  recipient_email: z.string().max(320).nullable().optional().default(null),
  source_email_id: z.string().uuid().nullable().optional().default(null),
  items: z.array(ItemInput).default([]),
});

// ============== CRUD ==============

export const listReports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("expense_reports")
      .select("id,title,mission_object,mission_context,organization,status,total_amount,amount_to_reimburse,currency,signature_date,recipient_email,sent_at,archived_at,created_at,updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = (data ?? []).map((r: any) => r.id);
    const counts = new Map<string, number>();
    if (ids.length > 0) {
      const { data: items } = await supabase.from("expense_items").select("report_id").in("report_id", ids);
      for (const it of (items ?? []) as any[]) counts.set(it.report_id, (counts.get(it.report_id) ?? 0) + 1);
    }
    const reports = (data ?? []).map((r: any) => {
      let derived: "in_progress" | "pre_send" | "sent" | "archived" = "in_progress";
      if (r.archived_at) derived = "archived";
      else if (r.sent_at) derived = "sent";
      else if (r.recipient_email && Number(r.total_amount) > 0 && (counts.get(r.id) ?? 0) > 0) derived = "pre_send";
      return { ...r, derived_status: derived };
    });
    return { reports };
  });

export const markReportSent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("expense_reports").update({ sent_at: new Date().toISOString(), archived_at: null }).eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleArchiveReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), archived: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("expense_reports").update({ archived_at: data.archived ? new Date().toISOString() : null }).eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: report, error } = await supabase
      .from("expense_reports")
      .select("*")
      .eq("user_id", userId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!report) throw new Error("Note de frais introuvable");
    const { data: items, error: itemsErr } = await supabase
      .from("expense_items")
      .select("*")
      .eq("report_id", data.id)
      .order("position");
    if (itemsErr) throw new Error(itemsErr.message);
    return { report, items: items ?? [] };
  });

function computeTotals(items: z.infer<typeof ItemInput>[], advance: number) {
  const total = items.reduce((s, it) => s + (Number(it.amount_ttc) || 0), 0);
  const toReimburse = Math.max(0, total - (Number(advance) || 0));
  return { total: Math.round(total * 100) / 100, toReimburse: Math.round(toReimburse * 100) / 100 };
}

export const upsertReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ReportUpsert.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { total, toReimburse } = computeTotals(data.items, data.advance_amount);

    const payload = {
      user_id: userId,
      title: data.title,
      mission_object: data.mission_object,
      mission_description: data.mission_description,
      mission_context: data.mission_context,
      organization: data.organization,
      mission_number: data.mission_number,
      identification: data.identification,
      status: data.status,
      total_amount: total,
      advance_amount: data.advance_amount,
      amount_to_reimburse: toReimburse,
      currency: data.currency,
      payment_method: data.payment_method,
      iban: data.iban,
      signature_location: data.signature_location,
      signature_date: data.signature_date,
      notes: data.notes,
      recipient_email: data.recipient_email,
      source_email_id: data.source_email_id,
    };

    let reportId = data.id;
    if (reportId) {
      const { error } = await supabase.from("expense_reports").update(payload).eq("id", reportId).eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { data: row, error } = await supabase.from("expense_reports").insert(payload).select("id").single();
      if (error) throw new Error(error.message);
      reportId = row.id;
    }

    // Replace items: delete all then insert
    await supabase.from("expense_items").delete().eq("report_id", reportId).eq("user_id", userId);
    if (data.items.length > 0) {
      const rows = data.items.map((it, idx) => ({
        report_id: reportId!,
        user_id: userId,
        date: it.date,
        category: it.category,
        description: it.description,
        vendor: it.vendor,
        amount_ttc: it.amount_ttc,
        tva_rate: it.tva_rate ?? 0,
        amount_ht: it.amount_ht,
        km_distance: it.km_distance,
        km_rate: it.km_rate,
        has_receipt: it.has_receipt,
        receipt_path: it.receipt_path,
        receipt_document_id: it.receipt_document_id,
        source_email_id: it.source_email_id,
        position: idx,
      }));
      const { error } = await supabase.from("expense_items").insert(rows);
      if (error) throw new Error(error.message);
    }

    return { id: reportId!, total, toReimburse };
  });

export const deleteReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("expense_reports").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============== Email candidates & extraction ==============

const KEYWORDS = ["facture", "reçu", "recu", "receipt", "invoice", "hôtel", "hotel", "billet", "ticket", "sncf", "air france", "ouigo", "trainline", "uber", "taxi", "booking", "airbnb", "vinci", "parking", "péage", "peage"];

export const listExpenseEmailCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ search: z.string().max(200).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const orFilter = KEYWORDS.map((k) => `subject.ilike.%${k}%`).join(",");
    let q = supabase
      .from("emails")
      .select("id,subject,from_address,from_name,received_at,has_attachment")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("received_at", { ascending: false })
      .limit(50);
    if (data.search) {
      q = q.or(`subject.ilike.%${data.search}%,from_address.ilike.%${data.search}%`);
    } else {
      q = q.or(orFilter);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { emails: rows ?? [] };
  });

const ExtractedExpense = z.object({
  date: z.string().nullable().default(null),
  amount_ttc: z.number().default(0),
  tva_rate: z.number().nullable().default(null),
  category: z.enum(CATEGORIES).default("autre"),
  description: z.string().default(""),
  vendor: z.string().default(""),
});

export const extractExpenseFromEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ emailId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");
    const { data: email, error } = await supabase
      .from("emails")
      .select("id,subject,from_name,from_address,received_at,body_text")
      .eq("user_id", userId)
      .eq("id", data.emailId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!email) throw new Error("Email introuvable");

    const sys = `Tu extrais UNE dépense d'un email (facture/reçu/billet) pour une note de frais.
Catégories valides : ${CATEGORIES.join(", ")}.
Réponds en JSON strict : {"date":"YYYY-MM-DD|null","amount_ttc":number,"tva_rate":number|null,"category":"<cat>","description":"<texte court>","vendor":"<fournisseur>"}.
Si pas de dépense claire, mets amount_ttc à 0.`;
    const user = `De: ${email.from_name ?? ""} <${email.from_address ?? ""}>
Date: ${email.received_at ?? ""}
Objet: ${email.subject ?? ""}

${(email.body_text ?? "").slice(0, 6000)}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        response_format: { type: "json_object" },
      }),
    });
    if (resp.status === 429) throw new Error("Limite IA atteinte");
    if (resp.status === 402) throw new Error("Crédits IA épuisés");
    if (!resp.ok) throw new Error(`Erreur IA (${resp.status})`);
    const json = await resp.json();
    const raw = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed;
    try { parsed = ExtractedExpense.parse(JSON.parse(raw)); } catch { parsed = ExtractedExpense.parse({}); }
    return { extracted: parsed, source_email_id: email.id };
  });

// ============== Templates ==============

export const listTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("expense_templates")
      .select("id,name,organization,file_type,mime_type,is_active,ai_mapping,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { templates: data ?? [] };
  });

export const createTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    name: z.string().min(1).max(255),
    organization: z.string().min(1).max(255),
    file_path: z.string().min(1).max(500),
    mime_type: z.string().max(100),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const ext = data.mime_type;
    const fileType = ext.includes("sheet") || ext.includes("excel") ? "excel"
      : ext.includes("pdf") ? "pdf"
      : ext.includes("word") || ext.includes("document") ? "word"
      : "excel";
    const { data: row, error } = await supabase
      .from("expense_templates")
      .insert({ user_id: userId, name: data.name, organization: data.organization, file_path: data.file_path, mime_type: data.mime_type, file_type: fileType })
      .select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: t } = await supabase.from("expense_templates").select("file_path").eq("id", data.id).eq("user_id", userId).maybeSingle();
    if (t?.file_path) await supabase.storage.from("expense-receipts").remove([t.file_path]);
    const { error } = await supabase.from("expense_templates").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const analyzeExpenseTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");
    const { data: t, error } = await supabase.from("expense_templates").select("*").eq("id", data.id).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!t || !t.file_path) throw new Error("Modèle introuvable");

    const { data: blob, error: dlErr } = await supabase.storage.from("expense-receipts").download(t.file_path);
    if (dlErr || !blob) throw new Error(dlErr?.message ?? "Téléchargement modèle impossible");
    const buf = new Uint8Array(await blob.arrayBuffer());

    let extractedText = "";
    let preview: any = {};
    try {
      if (t.file_type === "excel") {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, blankrows: false }) as any[][];
        preview = { sheetName: wb.SheetNames[0], rows: aoa.slice(0, 40) };
        extractedText = aoa.slice(0, 40).map((r) => r.join(" | ")).join("\n");
      } else if (t.file_type === "pdf") {
        const { PDFDocument } = await import("pdf-lib");
        const pdf = await PDFDocument.load(buf);
        const form = pdf.getForm();
        const fields = form.getFields().map((f) => ({ name: f.getName(), type: f.constructor.name }));
        preview = { fields };
        extractedText = `Champs de formulaire PDF :\n${fields.map((f) => `- ${f.name} (${f.type})`).join("\n")}`;
      } else {
        extractedText = "Modèle Word — analyse limitée. Décris les champs attendus.";
      }
    } catch (e: any) {
      extractedText = `(impossible d'analyser le fichier : ${e?.message ?? "erreur"})`;
    }

    const sys = `Tu analyses un modèle de note de frais. Réponds en JSON :
{
  "fields": [{"key":"identifiant_court","label":"libellé humain","hint":"où placer (cellule, nom de champ...)","value_from":"<title|fullName|institution|service|mission_object|organization|signature_date|signature_location|total_amount|advance_amount|amount_to_reimburse|iban|null>"}],
  "items_table": {"start_cell":"A10|null","columns":["date","category","description","amount_ttc","tva_rate","amount_ht"]}
}`;
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: sys }, { role: "user", content: `Modèle "${t.name}" (${t.file_type}) — ${t.organization}\n\nContenu détecté :\n${extractedText}` }],
        response_format: { type: "json_object" },
      }),
    });
    if (resp.status === 429) throw new Error("Limite IA atteinte");
    if (resp.status === 402) throw new Error("Crédits IA épuisés");
    if (!resp.ok) throw new Error(`Erreur IA (${resp.status})`);
    const j = await resp.json();
    let mapping: any = {};
    try { mapping = JSON.parse(j?.choices?.[0]?.message?.content ?? "{}"); } catch { mapping = {}; }
    mapping.preview = preview;

    await supabase.from("expense_templates").update({ ai_mapping: mapping }).eq("id", data.id).eq("user_id", userId);
    return { mapping };
  });

export const fillExpenseTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ reportId: z.string().uuid(), templateId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: t, error: tErr } = await supabase.from("expense_templates").select("*").eq("id", data.templateId).eq("user_id", userId).maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!t || !t.file_path) throw new Error("Modèle introuvable");
    const { data: report } = await supabase.from("expense_reports").select("*").eq("id", data.reportId).eq("user_id", userId).maybeSingle();
    if (!report) throw new Error("Note de frais introuvable");
    const { data: items } = await supabase.from("expense_items").select("*").eq("report_id", data.reportId).order("position");

    const { data: blob } = await supabase.storage.from("expense-receipts").download(t.file_path);
    if (!blob) throw new Error("Téléchargement modèle impossible");
    const buf = new Uint8Array(await blob.arrayBuffer());

    const ident = (report.identification ?? {}) as Record<string, string>;
    const valueFor = (key: string): string => {
      const map: Record<string, any> = {
        title: report.title,
        fullName: ident.fullName ?? DEFAULT_IDENTIFICATION.fullName,
        institution: ident.institution ?? DEFAULT_IDENTIFICATION.institution,
        service: ident.service ?? DEFAULT_IDENTIFICATION.service,
        mission_object: report.mission_object,
        organization: report.organization,
        signature_date: report.signature_date ?? new Date().toISOString().slice(0, 10),
        signature_location: report.signature_location,
        total_amount: String(report.total_amount),
        advance_amount: String(report.advance_amount),
        amount_to_reimburse: String(report.amount_to_reimburse),
        iban: report.iban,
      };
      return map[key] != null ? String(map[key]) : "";
    };

    let outBytes: Uint8Array;
    let outMime = t.mime_type ?? "application/octet-stream";
    let ext = t.file_type === "excel" ? "xlsx" : t.file_type === "pdf" ? "pdf" : "docx";

    if (t.file_type === "excel") {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const mapping = (t.ai_mapping as any) ?? {};
      // single-cell fields: ai may include cell hints like "B3"
      for (const f of mapping.fields ?? []) {
        if (f?.hint && /^[A-Z]+\d+$/.test(f.hint) && f.value_from) {
          sheet[f.hint] = { t: "s", v: valueFor(f.value_from) };
        }
      }
      // items table
      const startCell: string | undefined = mapping.items_table?.start_cell;
      const cols: string[] = mapping.items_table?.columns ?? ["date", "category", "description", "amount_ttc"];
      if (startCell && /^[A-Z]+\d+$/.test(startCell)) {
        const m = startCell.match(/^([A-Z]+)(\d+)$/)!;
        const startColLetter = m[1];
        const startRow = parseInt(m[2], 10);
        const colIdx = XLSX.utils.decode_col(startColLetter);
        (items ?? []).forEach((it, idx) => {
          cols.forEach((c, j) => {
            const addr = XLSX.utils.encode_cell({ c: colIdx + j, r: startRow - 1 + idx });
            const v = (it as any)[c];
            sheet[addr] = { t: typeof v === "number" ? "n" : "s", v: v ?? "" };
          });
        });
      }
      const outArr = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      outBytes = new Uint8Array(outArr);
      outMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else if (t.file_type === "pdf") {
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.load(buf);
      const form = pdf.getForm();
      const mapping = (t.ai_mapping as any) ?? {};
      for (const f of mapping.fields ?? []) {
        if (!f?.hint || !f?.value_from) continue;
        try { form.getTextField(f.hint).setText(valueFor(f.value_from)); } catch { /* skip */ }
      }
      outBytes = await pdf.save();
      outMime = "application/pdf";
    } else {
      // Word: pas de remplissage sans structure connue. On renvoie le modèle inchangé avec un avertissement.
      outBytes = buf;
      outMime = t.mime_type ?? "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }

    // base64
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < outBytes.length; i += chunk) bin += String.fromCharCode(...outBytes.subarray(i, i + chunk));
    const base64 = btoa(bin);
    const safe = (report.title || "Note de frais").replace(/[^\w\- ]+/g, "_");
    return { filename: `${safe}.${ext}`, mime: outMime, base64 };
  });

// ============== Documents integration ==============

export const saveReportToDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ reportId: z.string().uuid(), pdfBase64: z.string(), filename: z.string().max(255) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const bytes = Uint8Array.from(atob(data.pdfBase64), (c) => c.charCodeAt(0));
    const path = `${userId}/expenses/${data.reportId}/${Date.now()}_${data.filename.replace(/[^\w.\-]+/g, "_")}`;
    const { error: upErr } = await supabase.storage.from("documents").upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { data: doc, error } = await supabase.from("documents").insert({
      user_id: userId,
      filename: data.filename,
      original_filename: data.filename,
      file_size: bytes.byteLength,
      mime_type: "application/pdf",
      storage_path: path,
      source_type: "expense",
      source_id: data.reportId,
      tags: ["note-de-frais"],
      saved_at: new Date().toISOString(),
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { documentId: doc.id, path };
  });

// ============== Receipt upload helper (signed URL) ==============

export const getReceiptSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.path.startsWith(`${userId}/`)) throw new Error("Accès refusé");
    const { data: url, error } = await supabase.storage.from("expense-receipts").createSignedUrl(data.path, 3600);
    if (error) throw new Error(error.message);
    return { url: url.signedUrl };
  });

// ============== AI bridge: unify AI mail dialog ↔ structured form ==============

/**
 * Map a legacy/free-text AI category label to the structured ExpenseCategory enum.
 * Used to bridge AI-extracted items (which use free labels like "Transport",
 * "Hébergement", "Restauration", "Autre") into the structured Notes-de-frais form.
 */
export function mapLegacyCategoryToStructured(label: string | null | undefined): ExpenseCategory {
  const s = (label ?? "").toString().toLowerCase().trim();
  if (!s) return "autre";
  if (CATEGORIES.includes(s as ExpenseCategory)) return s as ExpenseCategory;
  if (/(taxi|uber|vtc|sncf|train|ouigo|tgv|métro|metro|bus|tram|ratp|avion|air ?france|vol|flight|trainline)/.test(s)) return "transport_commun";
  if (/(transport|déplacement|deplacement)/.test(s)) return "transport_commun";
  if (/(km|kilom|véhicule|vehicule|voiture|essence|carburant|péage|peage|parking|vinci)/.test(s)) return "vehicule_perso";
  if (/(hôtel|hotel|airbnb|booking|hébergement|hebergement|nuit|lodging)/.test(s)) return "hebergement";
  if (/(restau|repas|déjeuner|dejeuner|dîner|diner|meal|food|brasserie|café|cafe)/.test(s)) return "repas";
  if (/(inscription|registration|congrès|congres|conference)/.test(s)) return "inscription";
  if (/(livre|ouvrage|documentation|abonnement|revue|journal)/.test(s)) return "documentation";
  if (/(repro|impression|copie|copy|reprographie)/.test(s)) return "reprographie";
  if (/(matériel|materiel|fourniture|equipment|équipement)/.test(s)) return "materiel";
  if (/(téléphone|telephone|mobile|sim|forfait|roaming|wifi|internet)/.test(s)) return "telephone";
  if (/(visa|passeport)/.test(s)) return "visa";
  return "autre";
}

type AIInputItem = {
  date?: string | null;
  description?: string | null;
  category?: string | null;
  vendor?: string | null;
  amount_ttc?: number | null;
  amount_ht?: number | null;
  tva?: number | null;
  source_email_id?: string | null;
};

const AIItemSchema = z.object({
  date: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  amount_ttc: z.number().nullable().optional(),
  amount_ht: z.number().nullable().optional(),
  tva: z.number().nullable().optional(),
  source_email_id: z.string().uuid().nullable().optional(),
});

/**
 * Create a draft Notes-de-frais report from AI-extracted items
 * (the shape returned by `generateExpenseReport` in api/expense-report.functions.ts).
 * Categories are remapped via `mapLegacyCategoryToStructured`.
 */
export const createReportFromAIItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      title: z.string().min(1).max(255),
      mission_object: z.string().max(500).nullable().optional(),
      notes: z.string().max(4000).nullable().optional(),
      currency: z.string().max(8).default("EUR"),
      source_email_id: z.string().uuid().nullable().optional(),
      items: z.array(AIItemSchema).default([]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const today = new Date().toISOString().slice(0, 10);
    const mapped = data.items.map((it: AIInputItem, idx: number) => {
      const ttc = Number(it.amount_ttc ?? 0) || 0;
      const ht = it.amount_ht != null ? Number(it.amount_ht) : null;
      const tvaPct = (() => {
        if (it.tva != null && it.amount_ht && ht && ht > 0) {
          // tva is an amount → compute rate
          return Math.round((Number(it.tva) / ht) * 1000) / 10;
        }
        return 0;
      })();
      return {
        report_id: "", // filled after insert
        user_id: userId,
        date: (it.date && /^\d{4}-\d{2}-\d{2}$/.test(it.date)) ? it.date : today,
        category: mapLegacyCategoryToStructured(it.category ?? null),
        description: (it.description ?? "").slice(0, 500),
        vendor: it.vendor ?? null,
        amount_ttc: ttc,
        tva_rate: tvaPct,
        amount_ht: ht,
        km_distance: null,
        km_rate: null,
        has_receipt: false,
        receipt_path: null,
        receipt_document_id: null,
        source_email_id: it.source_email_id ?? null,
        position: idx,
      };
    });
    const total = Math.round(mapped.reduce((s, it) => s + it.amount_ttc, 0) * 100) / 100;
    const { data: report, error } = await supabase
      .from("expense_reports")
      .insert({
        user_id: userId,
        title: data.title,
        mission_object: data.mission_object ?? null,
        identification: DEFAULT_IDENTIFICATION,
        status: "draft",
        total_amount: total,
        advance_amount: 0,
        amount_to_reimburse: total,
        currency: data.currency ?? "EUR",
        signature_location: "Bordeaux",
        signature_date: today,
        notes: data.notes ?? null,
        source_email_id: data.source_email_id ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (mapped.length > 0) {
      const rows = mapped.map((m) => ({ ...m, report_id: report.id }));
      const { error: itErr } = await supabase.from("expense_items").insert(rows);
      if (itErr) throw new Error(itErr.message);
    }
    return { id: report.id as string, total };
  });

