import jsPDF from "jspdf";
import { CATEGORY_META } from "@/components/expenses/category-icons";
import type { ExpenseCategory } from "@/lib/expense.functions";

export type PdfPayload = {
  title: string;
  missionObject: string;
  missionContext: string;
  organization: string;
  missionNumber: string;
  ident: { fullName: string; title: string; service: string; institution: string; email: string; rpps: string };
  items: Array<{ date: string; category: ExpenseCategory; description: string; vendor: string | null; amount_ttc: number; tva_rate: number | null; amount_ht: number | null; has_receipt: boolean }>;
  total: number;
  advance: number;
  toReimburse: number;
  paymentMethod: string;
  iban: string;
  signatureLocation: string;
  signatureDate: string;
  notes: string;
};

export function generateExpensePDFClient(p: PdfPayload): { filename: string; base64: string } {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  let y = 16;

  doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text("Note de frais", 14, y); y += 7;
  doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.text(p.title, 14, y); y += 8;

  doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.text("Identification", 14, y); y += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  const idLines = [
    `${p.ident.fullName} — ${p.ident.title}`,
    `${p.ident.service}`,
    `${p.ident.institution}`,
    [p.ident.email, p.ident.rpps && `RPPS ${p.ident.rpps}`].filter(Boolean).join(" · "),
  ].filter(Boolean);
  idLines.forEach((l) => { doc.text(l, 14, y); y += 4.5; });
  y += 3;

  doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.text("Mission", 14, y); y += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  const m = [
    p.missionObject && `Objet : ${p.missionObject}`,
    p.missionContext && `Cadre : ${p.missionContext}`,
    p.organization && `Organisme : ${p.organization}`,
    p.missionNumber && `N° mission : ${p.missionNumber}`,
  ].filter(Boolean) as string[];
  if (m.length === 0) m.push("(non renseignée)");
  m.forEach((l) => { doc.text(l, 14, y); y += 4.5; });
  y += 4;

  // Items table
  doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.text("Dépenses", 14, y); y += 5;
  doc.setFontSize(8);
  doc.text("Date", 14, y); doc.text("Cat.", 32, y); doc.text("Description", 52, y);
  doc.text("Fourn.", 110, y); doc.text("HT", 150, y, { align: "right" }); doc.text("TVA", 168, y, { align: "right" });
  doc.text("TTC", pageW - 14, y, { align: "right" });
  y += 1.5; doc.line(14, y, pageW - 14, y); y += 4;
  doc.setFont("helvetica", "normal");
  p.items.forEach((it, idx) => {
    if (y > 270) { doc.addPage(); y = 18; }
    const ref = it.has_receipt ? ` [PJ${idx + 1}]` : "";
    doc.text(it.date || "—", 14, y);
    doc.text(CATEGORY_META[it.category]?.icon ?? "•", 32, y);
    const desc = doc.splitTextToSize((it.description || "") + ref, 56);
    doc.text(desc, 52, y);
    doc.text((it.vendor || "").slice(0, 22), 110, y);
    doc.text(it.amount_ht != null ? it.amount_ht.toFixed(2) : "—", 150, y, { align: "right" });
    doc.text(it.tva_rate != null && it.tva_rate > 0 ? `${it.tva_rate}%` : "—", 168, y, { align: "right" });
    doc.text(`${(Number(it.amount_ttc) || 0).toFixed(2)} €`, pageW - 14, y, { align: "right" });
    y += Math.max(5, desc.length * 4);
  });

  y += 2; doc.line(14, y, pageW - 14, y); y += 5;
  doc.setFont("helvetica", "bold");
  doc.text(`Total : ${p.total.toFixed(2)} €`, pageW - 14, y, { align: "right" }); y += 5;
  doc.setFont("helvetica", "normal");
  doc.text(`Avances reçues : ${p.advance.toFixed(2)} €`, pageW - 14, y, { align: "right" }); y += 5;
  doc.setFont("helvetica", "bold");
  doc.text(`À rembourser : ${p.toReimburse.toFixed(2)} €`, pageW - 14, y, { align: "right" }); y += 8;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`Mode : ${p.paymentMethod === "cheque" ? "Chèque" : "Virement"}${p.iban ? ` — IBAN ${p.iban}` : ""}`, 14, y); y += 8;

  // Pièces jointes
  const att = p.items.filter((it) => it.has_receipt);
  if (att.length > 0) {
    doc.setFont("helvetica", "bold"); doc.text(`Pièces jointes (${att.length})`, 14, y); y += 5;
    doc.setFont("helvetica", "normal");
    att.forEach((it, i) => {
      const idx = p.items.indexOf(it) + 1;
      doc.text(`PJ${idx} — ${it.date} · ${(it.description || "").slice(0, 60)}`, 14, y);
      y += 4.5;
      if (y > 275) { doc.addPage(); y = 18; }
    });
    y += 4;
  }

  if (p.notes) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(8);
    const n = doc.splitTextToSize(`Notes : ${p.notes}`, pageW - 28);
    doc.text(n, 14, y); y += n.length * 4 + 4;
  }

  if (y > 250) { doc.addPage(); y = 18; }
  y += 10;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`Fait à ${p.signatureLocation}, le ${p.signatureDate || new Date().toISOString().slice(0, 10)}`, 14, y); y += 6;
  doc.text(p.ident.fullName, 14, y); y += 4;
  doc.setFontSize(8); doc.setTextColor(120);
  doc.text("Signature :", 14, y); y += 18;
  doc.line(14, y, 80, y);

  const safe = (p.title || "Note de frais").replace(/[^\w\- ]+/g, "_");
  const dataUri = doc.output("datauristring");
  const base64 = dataUri.split(",")[1];
  return { filename: `${safe}.pdf`, base64 };
}
