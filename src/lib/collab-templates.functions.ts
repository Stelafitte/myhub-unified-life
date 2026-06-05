import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// List templates (personal + space-scoped) available for a space
// ============================================================
export const listAvailableTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ spaceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // personal templates (user_id = me, template_scope = 'personal')
    // + space templates (space_id = spaceId, template_scope = 'space')
    const [personal, spaceScoped] = await Promise.all([
      supabase
        .from("collab_documents")
        .select("id, title, template_scope, space_id, updated_at, user_id")
        .eq("user_id", userId)
        .eq("is_template", true)
        .eq("template_scope", "personal")
        .is("archived_at", null)
        .order("updated_at", { ascending: false }),
      supabase
        .from("collab_documents")
        .select("id, title, template_scope, space_id, updated_at, user_id")
        .eq("space_id", data.spaceId)
        .eq("is_template", true)
        .eq("template_scope", "space")
        .is("archived_at", null)
        .order("updated_at", { ascending: false }),
    ]);
    if (personal.error) throw new Error(personal.error.message);
    if (spaceScoped.error) throw new Error(spaceScoped.error.message);
    return {
      personal: personal.data ?? [],
      space: spaceScoped.data ?? [],
    };
  });

// ============================================================
// Save an existing document as a template
// ============================================================
export const saveAsTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        documentId: z.string().uuid(),
        scope: z.enum(["personal", "space"]).default("personal"),
        title: z.string().min(1).max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: src, error: e1 } = await supabase
      .from("collab_documents")
      .select("space_id, title, content, doc_type, collab_mode")
      .eq("id", data.documentId)
      .single();
    if (e1) throw new Error(e1.message);
    const { data: tpl, error: e2 } = await supabase
      .from("collab_documents")
      .insert({
        user_id: userId,
        space_id: src.space_id,
        title: data.title ?? `${src.title} (template)`,
        content: src.content,
        doc_type: src.doc_type,
        collab_mode: src.collab_mode,
        is_template: true,
        template_scope: data.scope,
        last_edited_by: userId,
      })
      .select()
      .single();
    if (e2) throw new Error(e2.message);
    return { template: tpl };
  });

// ============================================================
// Delete a template (soft archive)
// ============================================================
export const deleteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ templateId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("collab_documents")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", data.templateId)
      .eq("is_template", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
