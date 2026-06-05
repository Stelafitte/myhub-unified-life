import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// Helpers
// ============================================================

const IMAGE_BUCKET = "collab-doc-images";
const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

type JSONContent = Record<string, unknown>;

/**
 * Walks a Tiptap doc and re-signs image src that point to storage paths.
 * Image nodes inserted from uploads carry a `data-storage-path` attr.
 */
async function resignImagesInContent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  content: JSONContent | null | undefined,
): Promise<JSONContent | null | undefined> {
  if (!content || typeof content !== "object") return content;
  const paths = new Set<string>();
  const collect = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "image" && node.attrs?.["data-storage-path"]) {
      paths.add(node.attrs["data-storage-path"]);
    }
    if (Array.isArray(node.content)) node.content.forEach(collect);
  };
  collect(content);
  if (paths.size === 0) return content;

  const signedMap: Record<string, string> = {};
  const { data } = await supabase.storage
    .from(IMAGE_BUCKET)
    .createSignedUrls(Array.from(paths), SIGNED_URL_TTL_SEC);
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) signedMap[row.path] = row.signedUrl;
  }

  const apply = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "image" && node.attrs?.["data-storage-path"]) {
      const url = signedMap[node.attrs["data-storage-path"]];
      if (url) node.attrs.src = url;
    }
    if (Array.isArray(node.content)) node.content.forEach(apply);
  };
  apply(content);
  return content;
}

// ============================================================
// List documents in a space
// ============================================================

export const listSpaceDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ spaceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: docs, error } = await supabase
      .from("collab_documents")
      .select(
        "id, title, doc_type, collab_mode, is_template, office_provider, office_url, office_thumbnail_url, version_count, unresolved_comments, last_edited_at, updated_at, created_at",
      )
      .eq("space_id", data.spaceId)
      .eq("user_id", userId)
      .is("archived_at", null)
      .eq("is_template", false)
      .order("last_edited_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { documents: docs ?? [] };
  });

// ============================================================
// Get a single document (with re-signed image URLs)
// ============================================================

export const getCollabDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ documentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: doc, error } = await supabase
      .from("collab_documents")
      .select("*")
      .eq("id", data.documentId)
      .single();
    if (error) throw new Error(error.message);
    const content = await resignImagesInContent(supabase, doc.content);
    return { document: { ...doc, content } };
  });

// ============================================================
// Create a new native document
// ============================================================

export const createCollabDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        spaceId: z.string().uuid(),
        title: z.string().min(1).max(500).default("Document sans titre"),
        collabMode: z.enum(["async", "realtime"]).default("async"),
        templateSourceId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let initialContent: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph" }],
    };
    let initialTitle = data.title;

    if (data.templateSourceId) {
      const { data: tpl, error: tplErr } = await supabase
        .from("collab_documents")
        .select("title, content")
        .eq("id", data.templateSourceId)
        .single();
      if (tplErr) throw new Error(tplErr.message);
      initialContent = tpl.content as JSONContent;
      if (data.title === "Document sans titre") initialTitle = tpl.title;
    }

    const { data: doc, error } = await supabase
      .from("collab_documents")
      .insert({
        user_id: userId,
        space_id: data.spaceId,
        title: initialTitle,
        doc_type: "native",
        collab_mode: data.collabMode,
        content: initialContent,
        template_source_id: data.templateSourceId ?? null,
        last_edited_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { document: doc };
  });

// ============================================================
// Save / update a document (autosave) — also creates a version
// ============================================================

export const saveCollabDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        documentId: z.string().uuid(),
        title: z.string().min(1).max(500),
        content: z.record(z.string(), z.unknown()),
        changeSummary: z.string().max(500).optional(),
        createVersion: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Optimistic update + bump counters
    const { data: doc, error } = await supabase
      .from("collab_documents")
      .update({
        title: data.title,
        content: data.content,
        last_edited_at: new Date().toISOString(),
        last_edited_by: userId,
        version_count: data.createVersion ? undefined : undefined,
      })
      .eq("id", data.documentId)
      .select()
      .single();
    if (error) throw new Error(error.message);

    let versionNumber: number | null = null;
    if (data.createVersion) {
      versionNumber = (doc.version_count ?? 0) + 1;
      const { error: vErr } = await supabase
        .from("collab_document_versions")
        .insert({
          document_id: data.documentId,
          user_id: userId,
          version_number: versionNumber,
          title: data.title,
          content: data.content,
          change_summary: data.changeSummary ?? null,
        });
      if (vErr) throw new Error(vErr.message);

      await supabase
        .from("collab_documents")
        .update({ version_count: versionNumber })
        .eq("id", data.documentId);
    }

    return {
      savedAt: new Date().toISOString(),
      versionNumber,
    };
  });

// ============================================================
// Rename / delete / duplicate
// ============================================================

export const renameCollabDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        documentId: z.string().uuid(),
        title: z.string().min(1).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("collab_documents")
      .update({ title: data.title })
      .eq("id", data.documentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCollabDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ documentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("collab_documents")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", data.documentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const duplicateCollabDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ documentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: src, error: e1 } = await supabase
      .from("collab_documents")
      .select("space_id, title, content, doc_type, collab_mode")
      .eq("id", data.documentId)
      .single();
    if (e1) throw new Error(e1.message);
    const { data: copy, error: e2 } = await supabase
      .from("collab_documents")
      .insert({
        user_id: userId,
        space_id: src.space_id,
        title: `${src.title} (copie)`,
        content: src.content,
        doc_type: src.doc_type,
        collab_mode: src.collab_mode,
        last_edited_by: userId,
      })
      .select()
      .single();
    if (e2) throw new Error(e2.message);
    return { document: copy };
  });

// ============================================================
// Image upload (base64) → returns signed URL + storage path
// ============================================================

export const uploadDocumentImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        documentId: z.string().uuid(),
        filename: z.string().min(1).max(255),
        contentType: z.string().regex(/^image\/(png|jpe?g|gif|webp|svg\+xml)$/),
        dataBase64: z.string().min(1).max(20 * 1024 * 1024),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const ext = (data.filename.split(".").pop() ?? "bin").toLowerCase();
    const path = `${userId}/${data.documentId}/${crypto.randomUUID()}.${ext}`;
    const bytes = Uint8Array.from(atob(data.dataBase64), (c) => c.charCodeAt(0));
    const { error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (error) throw new Error(error.message);
    const { data: signed, error: sErr } = await supabase.storage
      .from(IMAGE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SEC);
    if (sErr) throw new Error(sErr.message);
    return { storagePath: path, signedUrl: signed.signedUrl };
  });
