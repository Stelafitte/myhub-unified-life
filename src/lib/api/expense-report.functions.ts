import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AttachmentSchema = z.object({
  name: z.string().max(255),
  mime: z.string().max(100),
  dataBase64: z.string().max(8_000_000),
});

const Input = z.object({
  emailIds: z.array(z.string().uuid()).max(50).default([]),
  instruction: z.string().max(4000).optional().nullable(),
  attachments: z.array(AttachmentSchema).max(10).default([]),
});

const ItemSchema = z.object({
  date: z.string().nullable().default(null), // ISO yyyy-mm-dd if possible
  description: z.string().default(""),
  category: z.string().default("Transport"),
  vendor: z.string().default(""),
  reference: z.string().default(""),
  amount_ttc: z.number().default(0),
  amount_ht: z.number().nullable().default(null),
  tva: z.number().nullable().default(null),
  currency: z.string().default("EUR"),
  source_email_id: z.string().nullable().default(null),
});
export type ExpenseItem = z.infer<typeof ItemSchema>;

const ExtractSchema = z.object({
  items: z.array(ItemSchema).default([]),
  notes: z.string().default(""),
});

export type ExpenseReportResult = {
  items: ExpenseItem[];
  csv: string;
  title: string;
  total: number;
  currency: string;
  periodFrom: string | null;
  periodTo: string | null;
  notes: string;
};

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(items: ExpenseItem[]): string {
  const header = ["Date", "Description", "Catégorie", "Fournisseur", "Référence", "Montant HT", "TVA", "Montant TTC", "Devise"];
  const lines = [header.join(";")];
  for (const it of items) {
    lines.push([
      it.date ?? "",
      it.description,
      it.category,
      it.vendor,
      it.reference,
      it.amount_ht ?? "",
      it.tva ?? "",
      it.amount_ttc,
      it.currency,
    ].map(csvEscape).join(";"));
  }
  return lines.join("\n");
}

export const generateExpenseReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<ExpenseReportResult> => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    let emails: any[] = [];
    if (data.emailIds.length > 0) {
      const { data: rows, error } = await supabase
        .from("emails")
        .select("id,subject,from_address,from_name,received_at,body_text")
        .eq("user_id", userId)
        .in("id", data.emailIds);
      if (error) throw new Error(error.message);
      emails = rows ?? [];
    }

    // Auto-fetch attachments archived for these emails (documents.source_type='email')
    type FetchedAtt = { name: string; mime: string; dataBase64: string; sourceEmailId: string | null };
    const fetchedAtts: FetchedAtt[] = [];
    const skippedAtts: string[] = [];
    if (data.emailIds.length > 0) {
      const { data: docs } = await supabase
        .from("documents")
        .select("id,filename,original_filename,mime_type,storage_path,source_id")
        .eq("user_id", userId)
        .eq("source_type", "email")
        .in("source_id", data.emailIds)
        .limit(20);
      for (const d of (docs ?? []) as any[]) {
        if (!d.storage_path) continue;
        const mime = (d.mime_type ?? "").toString();
        const name = d.original_filename ?? d.filename ?? "pj";
        if (!mime.startsWith("image/") && mime !== "application/pdf") {
          skippedAtts.push(`${name} (${mime || "type inconnu"})`);
          continue;
        }
        try {
          const { data: blob, error: dErr } = await supabase.storage.from("documents").download(d.storage_path);
          if (dErr || !blob) continue;
          const buf = new Uint8Array(await blob.arrayBuffer());
          if (buf.byteLength > 6 * 1024 * 1024) { skippedAtts.push(`${name} (trop volumineux)`); continue; }
          let bin = "";
          for (let i = 0; i < buf.byteLength; i++) bin += String.fromCharCode(buf[i]);
          const b64 = typeof btoa !== "undefined" ? btoa(bin) : Buffer.from(buf).toString("base64");
          fetchedAtts.push({ name, mime, dataBase64: b64, sourceEmailId: d.source_id ?? null });
        } catch {
          skippedAtts.push(name);
        }
      }
    }

    const extraAtts: FetchedAtt[] = data.attachments.map((a) => ({ ...a, sourceEmailId: null }));
    const allAttachments: FetchedAtt[] = [...fetchedAtts, ...extraAtts];

    if (emails.length === 0 && allAttachments.length === 0) {
      throw new Error("Aucun email ni pièce jointe fourni.");
    }

    const corpus = emails.map((e, i) => {
      const atts = fetchedAtts.filter((a) => a.sourceEmailId === e.id).map((a) => a.name);
      return `=== EMAIL ${i + 1} (id=${e.id}) ===
De : ${e.from_name ?? ""} <${e.from_address ?? ""}>
Date : ${e.received_at ?? ""}
Objet : ${e.subject ?? ""}
${atts.length ? `Pièces jointes analysées : ${atts.join(", ")}\n` : ""}
${(e.body_text ?? "").slice(0, 8000)}`;
    }).join("\n\n");

    const sys = `Tu es un assistant comptable. À partir des emails ET des pièces jointes (images de billets/reçus, factures PDF) fournis, tu extrais une LISTE de lignes de dépenses pour une note de frais.
Réponds UNIQUEMENT en JSON valide avec ce schéma :
{
  "items": [{
    "date": "YYYY-MM-DD ou null",
    "description": "ex: Trajet SNCF Paris → Lyon",
    "category": "Transport|Hébergement|Restauration|Autre",
    "vendor": "ex: SNCF",
    "reference": "n° billet/réservation/facture",
    "amount_ttc": 0.0,
    "amount_ht": null,
    "tva": null,
    "currency": "EUR",
    "source_email_id": "uuid de l'email source OU null si vient d'une PJ"
  }],
  "notes": "remarques éventuelles (incertitudes, lignes ignorées, PJ illisibles…)"
}
RÈGLES :
- Analyse aussi bien le corps des emails que chaque pièce jointe (billet, facture, reçu).
- Une ligne par trajet/prestation facturée. Pour un aller-retour SNCF, crée 2 lignes (aller + retour).
- Montants en euros, point décimal. Ne dépasse jamais ce que mentionne explicitement la source.
- Si une source ne contient pas de dépense, ignore-la.
- "source_email_id" : id de l'email source si applicable, sinon null.
- Sois concis dans description.`;

    const userContent: any[] = [
      { type: "text", text: `${data.instruction ? `Instruction utilisateur : ${data.instruction}\n\n` : ""}${emails.length > 0 ? `Emails à traiter :\n\n${corpus}` : "Aucun email — analyse uniquement les pièces jointes ci-dessous."}` },
    ];
    for (const att of allAttachments) {
      if (att.mime.startsWith("image/") || att.mime === "application/pdf") {
        userContent.push({
          type: "image_url",
          image_url: { url: `data:${att.mime};base64,${att.dataBase64}` },
        });
      } else {
        userContent.push({ type: "text", text: `[PJ non lisible : ${att.name} (${att.mime})]` });
      }
    }


    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (resp.status === 429) throw new Error("Limite IA atteinte, réessayez dans un instant.");
    if (resp.status === 402) throw new Error("Crédits IA épuisés.");
    if (!resp.ok) throw new Error(`Erreur IA (${resp.status})`);
    const json = await resp.json();
    const raw = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: z.infer<typeof ExtractSchema>;
    try {
      parsed = ExtractSchema.parse(JSON.parse(raw));
    } catch {
      parsed = { items: [], notes: "" };
    }

    const items = parsed.items.filter((it) => it.amount_ttc > 0 || it.description);
    const total = items.reduce((s, it) => s + (Number(it.amount_ttc) || 0), 0);
    const currency = items[0]?.currency ?? "EUR";
    const dates = items.map((i) => i.date).filter(Boolean) as string[];
    dates.sort();
    const periodFrom = dates[0] ?? null;
    const periodTo = dates[dates.length - 1] ?? null;

    const title = `Note de frais ${periodFrom ?? new Date().toISOString().slice(0, 10)}${periodTo && periodTo !== periodFrom ? ` → ${periodTo}` : ""}`;
    const csv = buildCsv(items);

    return { items, csv, title, total, currency, periodFrom, periodTo, notes: parsed.notes };
  });
