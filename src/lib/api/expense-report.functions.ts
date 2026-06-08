import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  emailIds: z.array(z.string().uuid()).min(1).max(50),
  instruction: z.string().max(2000).optional().nullable(),
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

    const { data: rows, error } = await supabase
      .from("emails")
      .select("id,subject,from_address,from_name,received_at,body_text")
      .eq("user_id", userId)
      .in("id", data.emailIds);
    if (error) throw new Error(error.message);
    const emails = rows ?? [];
    if (emails.length === 0) throw new Error("Aucun email trouvé.");

    const corpus = emails.map((e, i) => {
      return `=== EMAIL ${i + 1} (id=${e.id}) ===
De : ${e.from_name ?? ""} <${e.from_address ?? ""}>
Date : ${e.received_at ?? ""}
Objet : ${e.subject ?? ""}

${(e.body_text ?? "").slice(0, 8000)}`;
    }).join("\n\n");

    const sys = `Tu es un assistant comptable. À partir des emails fournis (billets, factures, confirmations de voyage, reçus…), tu extrais une LISTE de lignes de dépenses pour une note de frais.
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
    "source_email_id": "uuid de l'email source"
  }],
  "notes": "remarques éventuelles (incertitudes, lignes ignorées…)"
}
RÈGLES :
- Une ligne par trajet/prestation facturée. Pour un aller-retour SNCF, crée 2 lignes (aller + retour) avec les montants respectifs si possible.
- Montants en euros, point décimal. Ne dépasse jamais ce que mentionne explicitement l'email.
- Si l'email ne contient pas de dépense (newsletter, simple info), ignore-le.
- "source_email_id" doit correspondre à l'id indiqué dans "EMAIL X (id=...)".
- Sois concis dans description.`;

    const usr = `${data.instruction ? `Instruction utilisateur : ${data.instruction}\n\n` : ""}Emails à traiter :\n\n${corpus}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr },
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
