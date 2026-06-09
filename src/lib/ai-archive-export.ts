// Browser-side helper: zips a selection of emails + their attachments + standalone
// documents, downloads the .zip, and persists it as a new entry in the user's
// document library (storage bucket "documents" + row in public.documents).
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";

type SelectedKind = "email" | "document" | (string & {});
export type SelectedItem = { id: string; kind: SelectedKind };

function safe(s: string | null | undefined, max = 60): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, max) || "sans-nom";
}

export type ZipExportResult = {
  zipName: string;
  emailCount: number;
  documentCount: number;
  attachmentCount: number;
  savedToLibrary: boolean;
};

/**
 * Builds a ZIP from the selected items, downloads it locally, and uploads it
 * to the user's document library. Returns a summary suitable for chat display.
 */
export async function buildAndSaveArchive(
  items: SelectedItem[],
  userId: string,
  label?: string,
): Promise<ZipExportResult> {
  const emailIds = items.filter((i) => i.kind === "email").map((i) => i.id);
  const docIds = items.filter((i) => i.kind === "document").map((i) => i.id);

  if (emailIds.length === 0 && docIds.length === 0) {
    throw new Error("Aucun élément sélectionné à archiver.");
  }

  // 1. Fetch metadata
  const [emailsRes, attachRes, docsRes] = await Promise.all([
    emailIds.length
      ? supabase
          .from("emails")
          .select(
            "id,subject,from_address,from_name,to_address,received_at,body_text,body_html",
          )
          .in("id", emailIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    emailIds.length
      ? supabase
          .from("documents")
          .select("id,filename,storage_path,source_id,mime_type")
          .eq("source_type", "email")
          .in("source_id", emailIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    docIds.length
      ? supabase
          .from("documents")
          .select("id,filename,storage_path,mime_type")
          .in("id", docIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);

  type EmailRow = {
    id: string;
    subject: string | null;
    from_address: string | null;
    from_name: string | null;
    to_address: string | null;
    received_at: string | null;
    body_text: string | null;
    body_html: string | null;
  };
  type DocRow = {
    id: string;
    filename: string;
    storage_path: string | null;
    source_id?: string | null;
    mime_type: string | null;
  };

  const emails = (emailsRes.data ?? []) as EmailRow[];
  const attachments = (attachRes.data ?? []) as DocRow[];
  const docs = (docsRes.data ?? []) as DocRow[];

  // 2. Build zip
  const zip = new JSZip();
  let attCount = 0;

  // README / summary
  const summary = [
    `Archive MyHub Pro générée le ${new Date().toLocaleString("fr-FR")}`,
    label ? `Contexte : ${label}` : null,
    `Emails : ${emails.length}`,
    `Documents : ${docs.length}`,
    `Pièces jointes : ${attachments.length}`,
  ]
    .filter(Boolean)
    .join("\n");
  zip.file("README.txt", summary);

  // Emails (one folder per email)
  if (emails.length > 0) {
    const emailsFolder = zip.folder("emails")!;
    // Deterministic naming with index to avoid collisions
    emails.sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? ""));
    let idx = 1;
    for (const e of emails) {
      const datePart = (e.received_at ?? "").slice(0, 10) || "sans-date";
      const folderName = `${String(idx).padStart(3, "0")}_${datePart}_${safe(e.subject, 50)}`;
      const folder = emailsFolder.folder(folderName)!;
      const header = [
        `De      : ${e.from_name ?? ""} <${e.from_address ?? ""}>`,
        `À       : ${e.to_address ?? ""}`,
        `Date    : ${e.received_at ?? ""}`,
        `Sujet   : ${e.subject ?? ""}`,
        "",
        "----------------------------------------",
        "",
      ].join("\n");
      folder.file("email.txt", header + (e.body_text ?? ""));
      if (e.body_html) {
        folder.file(
          "email.html",
          `<!doctype html><meta charset="utf-8"><title>${(e.subject ?? "").replace(/[<>&"]/g, "")}</title>${e.body_html}`,
        );
      }
      const myAtts = attachments.filter((a) => a.source_id === e.id);
      if (myAtts.length > 0) {
        const atFolder = folder.folder("pieces-jointes")!;
        for (const a of myAtts) {
          if (!a.storage_path) continue;
          try {
            const { data } = await supabase.storage.from("documents").download(a.storage_path);
            if (data) {
              atFolder.file(a.filename || `pj-${a.id}.bin`, data);
              attCount++;
            }
          } catch {
            // ignore individual attachment failures
          }
        }
      }
      idx++;
    }
  }

  // Standalone documents
  if (docs.length > 0) {
    const docsFolder = zip.folder("documents")!;
    for (const d of docs) {
      if (!d.storage_path) continue;
      try {
        const { data } = await supabase.storage.from("documents").download(d.storage_path);
        if (data) docsFolder.file(d.filename || `doc-${d.id}.bin`, data);
      } catch {
        // ignore
      }
    }
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const zipName = `archive-myhub_${stamp}.zip`;

  // 3. Download locally
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = zipName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  // 4. Persist to user's document library
  let savedToLibrary = false;
  try {
    const storagePath = `archives/${userId}/${zipName}`;
    const upload = await supabase.storage.from("documents").upload(storagePath, blob, {
      contentType: "application/zip",
      upsert: false,
    });
    if (!upload.error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insErr } = await (supabase as any).from("documents").insert({
        user_id: userId,
        filename: zipName,
        original_filename: zipName,
        file_size: blob.size,
        mime_type: "application/zip",
        storage_path: storagePath,
        source_type: "manual",
        tags: ["archive-ia"],
        description: `Archive IA · ${emails.length} email(s), ${docs.length} doc(s), ${attCount} PJ${label ? " · " + label.slice(0, 80) : ""}`,
      });
      savedToLibrary = !insErr;
    }
  } catch {
    // Local download already succeeded — library save is best-effort
  }

  return {
    zipName,
    emailCount: emails.length,
    documentCount: docs.length,
    attachmentCount: attCount,
    savedToLibrary,
  };
}
