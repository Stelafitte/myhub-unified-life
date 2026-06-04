// Helper partagé : charge les prompts utilisateur actifs depuis ai_prompts
// et construit un bloc de consignes à concaténer dans le system prompt.

export type AiPromptTarget =
  | "general"
  | "email_reply"
  | "email_classify"
  | "task_create"
  | "meeting"
  | "meeting_slots"
  | "document"
  | "dashboard";

export async function loadActivePromptsBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  targets: AiPromptTarget[],
): Promise<string> {
  try {
    // Toujours inclure "general" en plus des cibles spécifiques.
    const all = Array.from(new Set<string>(["general", ...targets]));
    const { data } = await supabase
      .from("ai_prompts")
      .select("title,target,content")
      .eq("user_id", userId)
      .eq("is_active", true)
      .in("target", all);
    const rows = (data ?? []).filter(
      (p: { content?: string }) => (p.content ?? "").trim().length > 0,
    );
    if (rows.length === 0) return "";
    const lines = rows.map(
      (p: { title: string; target: string; content: string }) =>
        `# ${p.title} (${p.target})\n${p.content.trim()}`,
    );
    return `\n\n--- Instructions personnalisées de l'utilisateur (à respecter en priorité, elles priment sur toute consigne contraire ci-dessus) ---\n${lines.join("\n\n")}\n--- Fin des instructions personnalisées ---`;
  } catch {
    return "";
  }
}
