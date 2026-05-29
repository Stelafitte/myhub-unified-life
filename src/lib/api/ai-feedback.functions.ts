import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PRIORITIES = ["urgent", "important", "normal", "low"] as const;
const CATEGORIES = [
  "action",
  "rendez-vous",
  "document",
  "facturation",
  "rh",
  "info",
  "newsletter",
] as const;

const Input = z.object({
  emailId: z.string().uuid(),
  correctedPriority: z.enum(PRIORITIES).nullable().optional(),
  correctedCategory: z.enum(CATEGORIES).nullable().optional(),
});

export const recordAiFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: e, error } = await supabase
      .from("emails")
      .select("id,from_address,subject,ai_priority,ai_category")
      .eq("id", data.emailId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !e) throw new Error(error?.message ?? "Email introuvable");

    const newPriority = data.correctedPriority ?? e.ai_priority;
    const newCategory = data.correctedCategory ?? e.ai_category;

    const { error: fbErr } = await supabase.from("ai_feedback").insert({
      user_id: userId,
      email_id: e.id,
      from_address: e.from_address,
      subject: e.subject,
      original_priority: e.ai_priority,
      corrected_priority: data.correctedPriority ?? null,
      original_category: e.ai_category,
      corrected_category: data.correctedCategory ?? null,
    });
    if (fbErr) throw new Error(fbErr.message);

    const { error: upErr } = await supabase
      .from("emails")
      .update({ ai_priority: newPriority, ai_category: newCategory })
      .eq("id", e.id);
    if (upErr) throw new Error(upErr.message);

    return { ok: true };
  });
