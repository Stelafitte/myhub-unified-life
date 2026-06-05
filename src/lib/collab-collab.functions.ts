import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type AuthCtx = { supabase: ReturnType<typeof getSb>; userId: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSb(): any {
  return null;
}

// ---------- COMMENTS ----------

export interface DocCommentRow {
  id: string;
  document_id: string;
  user_id: string;
  parent_id: string | null;
  anchor_text: string | null;
  anchor_from: number | null;
  anchor_to: number | null;
  body: string;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
}

const ListInput = z.object({
  documentId: z.string().uuid(),
  includeResolved: z.boolean().default(false),
});

export const listDocumentComments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as AuthCtx;
    let q = supabase
      .from("collab_document_comments")
      .select("*")
      .eq("document_id", data.documentId)
      .order("created_at", { ascending: true });
    if (!data.includeResolved) q = q.eq("resolved", false);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { comments: (rows ?? []) as DocCommentRow[] };
  });

const CreateInput = z.object({
  documentId: z.string().uuid(),
  body: z.string().min(1).max(5000),
  parentId: z.string().uuid().nullable().optional(),
  anchorText: z.string().max(500).nullable().optional(),
  anchorFrom: z.number().int().nonnegative().nullable().optional(),
  anchorTo: z.number().int().nonnegative().nullable().optional(),
});

export const createDocumentComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as AuthCtx;
    const { data: row, error } = await supabase
      .from("collab_document_comments")
      .insert({
        document_id: data.documentId,
        user_id: userId,
        parent_id: data.parentId ?? null,
        body: data.body,
        anchor_text: data.anchorText ?? null,
        anchor_from: data.anchorFrom ?? null,
        anchor_to: data.anchorTo ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Update unresolved count
    await supabase.rpc; // no-op to keep TS happy
    const { count } = await supabase
      .from("collab_document_comments")
      .select("id", { count: "exact", head: true })
      .eq("document_id", data.documentId)
      .eq("resolved", false);
    await supabase
      .from("collab_documents")
      .update({ unresolved_comments: count ?? 0 })
      .eq("id", data.documentId);

    return { comment: row as DocCommentRow };
  });

const ResolveInput = z.object({
  commentId: z.string().uuid(),
  resolved: z.boolean(),
});

export const setDocumentCommentResolved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ResolveInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as AuthCtx;
    const { data: row, error } = await supabase
      .from("collab_document_comments")
      .update({
        resolved: data.resolved,
        resolved_at: data.resolved ? new Date().toISOString() : null,
        resolved_by: data.resolved ? userId : null,
      })
      .eq("id", data.commentId)
      .select("document_id")
      .single();
    if (error) throw new Error(error.message);
    if (row?.document_id) {
      const { count } = await supabase
        .from("collab_document_comments")
        .select("id", { count: "exact", head: true })
        .eq("document_id", row.document_id)
        .eq("resolved", false);
      await supabase
        .from("collab_documents")
        .update({ unresolved_comments: count ?? 0 })
        .eq("id", row.document_id);
    }
    return { ok: true };
  });

const DeleteInput = z.object({ commentId: z.string().uuid() });

export const deleteDocumentComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DeleteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as AuthCtx;
    const { data: row } = await supabase
      .from("collab_document_comments")
      .select("document_id")
      .eq("id", data.commentId)
      .single();
    const { error } = await supabase
      .from("collab_document_comments")
      .delete()
      .eq("id", data.commentId);
    if (error) throw new Error(error.message);
    if (row?.document_id) {
      const { count } = await supabase
        .from("collab_document_comments")
        .select("id", { count: "exact", head: true })
        .eq("document_id", row.document_id)
        .eq("resolved", false);
      await supabase
        .from("collab_documents")
        .update({ unresolved_comments: count ?? 0 })
        .eq("id", row.document_id);
    }
    return { ok: true };
  });

// ---------- VERSIONS ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonContent = any;

export interface DocVersionRow {
  id: string;
  document_id: string;
  version_number: number;
  title: string;
  content: JsonContent;
  change_summary: string | null;
  created_by: string | null;
  created_at: string;
}

const ListVersionsInput = z.object({ documentId: z.string().uuid() });

export const listDocumentVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListVersionsInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as AuthCtx;
    const { data: rows, error } = await supabase
      .from("collab_document_versions")
      .select(
        "id, document_id, version_number, title, change_summary, created_by, created_at",
      )
      .eq("document_id", data.documentId)
      .order("version_number", { ascending: false });
    if (error) throw new Error(error.message);
    return {
      versions: (rows ?? []) as Array<Omit<DocVersionRow, "content">>,
    };
  });

const GetVersionInput = z.object({ versionId: z.string().uuid() });

export const getDocumentVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GetVersionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as AuthCtx;
    const { data: row, error } = await supabase
      .from("collab_document_versions")
      .select("*")
      .eq("id", data.versionId)
      .single();
    if (error) throw new Error(error.message);
    return { version: row as DocVersionRow };
  });

const RestoreInput = z.object({ versionId: z.string().uuid() });

export const restoreDocumentVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RestoreInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as AuthCtx;
    const { data: v, error: vErr } = await supabase
      .from("collab_document_versions")
      .select("*")
      .eq("id", data.versionId)
      .single();
    if (vErr || !v) throw new Error(vErr?.message ?? "Version introuvable");

    // Snapshot the current state as a new version before overwriting
    const { data: doc, error: dErr } = await supabase
      .from("collab_documents")
      .select("id, title, content, version_count")
      .eq("id", v.document_id)
      .single();
    if (dErr || !doc) throw new Error(dErr?.message ?? "Document introuvable");

    const nextVersion = (doc.version_count ?? 0) + 1;
    await supabase.from("collab_document_versions").insert({
      document_id: doc.id,
      version_number: nextVersion,
      title: doc.title,
      content: doc.content,
      change_summary: "Sauvegarde avant restauration",
      created_by: userId,
    });

    const restoredVersion = nextVersion + 1;
    await supabase
      .from("collab_documents")
      .update({
        title: v.title,
        content: v.content,
        version_count: restoredVersion,
        last_edited_by: userId,
        last_edited_at: new Date().toISOString(),
      })
      .eq("id", doc.id);

    await supabase.from("collab_document_versions").insert({
      document_id: doc.id,
      version_number: restoredVersion,
      title: v.title,
      content: v.content,
      change_summary: `Restauration de la version v${v.version_number}`,
      created_by: userId,
    });

    return {
      restoredFrom: v.version_number,
      newVersion: restoredVersion,
      title: v.title as string,
      content: v.content as JsonContent,
    };
  });
