// Phase 2 — Commandes vocales d'action sur l'Inbox.
// Le LLM classe l'intention de l'utilisateur :
//  - "reply" : simple réponse conversationnelle (rien à faire)
//  - "action" : une opération destructive/non destructive sur les mails
//
// 3 actions supportées pour l'instant :
//  - delete_current_email : supprime (corbeille) le mail actuellement ouvert
//  - delete_emails_by_sender : corbeille tous les mails d'un expéditeur
//  - archive_theme_emails : archive tous les mails d'un thème
//
// Aucune mutation ici : on retourne un PLAN avec un aperçu (count + 5 exemples).
// L'exécution se fait via `aiVoiceCommandExecute` après confirmation utilisateur.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PlanInput = z.object({
  prompt: z.string().min(1).max(2000),
  currentEmailId: z.string().uuid().nullable().optional(),
  currentRoute: z.string().max(120).nullable().optional(),
});

const PlanSchema = z.object({
  kind: z.enum(["reply", "action"]),
  reply: z.string().max(2000).default(""),
  action_type: z
    .enum([
      "delete_current_email",
      "delete_emails_by_sender",
      "archive_theme_emails",
      "none",
    ])
    .default("none"),
  // paramètres extraits
  sender: z.string().max(200).default(""),
  theme_name: z.string().max(200).default(""),
  confirmation_message: z.string().max(400).default(""),
});

export type AiVoicePlan =
  | { kind: "reply"; reply: string }
  | {
      kind: "action";
      actionType: "delete_current_email" | "delete_emails_by_sender" | "archive_theme_emails";
      params: { emailId?: string; sender?: string; themeId?: string; themeName?: string };
      preview: { count: number; samples: { id: string; subject: string; from: string; date: string | null }[] };
      confirmationMessage: string;
      destructive: boolean;
    };

async function callGateway(key: string, body: unknown) {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 429) throw new Error("Limite IA atteinte, réessayez.");
    if (resp.status === 402) throw new Error("Crédits IA épuisés.");
    throw new Error(`Erreur IA (${resp.status}): ${text.slice(0, 200)}`);
  }
  return resp.json();
}

export const aiVoiceCommandPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PlanInput.parse(d))
  .handler(async ({ data, context }): Promise<AiVoicePlan> => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    // Charger la liste des thèmes pour aider le LLM à matcher.
    const { data: themesData } = await supabase
      .from("email_themes")
      .select("id,name")
      .eq("user_id", userId)
      .is("archived_at", null)
      .limit(80);
    const themes = (themesData ?? []) as { id: string; name: string }[];

    let currentEmailInfo = "";
    if (data.currentEmailId) {
      const { data: e } = await supabase
        .from("emails")
        .select("subject,from_address,from_name")
        .eq("id", data.currentEmailId)
        .maybeSingle();
      if (e) currentEmailInfo = `Mail actuellement ouvert : "${e.subject ?? ""}" de ${e.from_name ?? e.from_address ?? ""}`;
    }

    const sys = `Tu es un agent vocal qui interprète des ordres en français sur la messagerie MyHub Pro.
Tu réponds UNIQUEMENT en JSON valide avec ce schéma :
{
 "kind": "reply" | "action",
 "reply": "réponse conversationnelle si kind=reply",
 "action_type": "delete_current_email" | "delete_emails_by_sender" | "archive_theme_emails" | "none",
 "sender": "fragment de nom ou d'email expéditeur si pertinent",
 "theme_name": "nom du thème à matcher si pertinent",
 "confirmation_message": "phrase courte FR à montrer à l'utilisateur avant exécution (ex: 'Supprimer les 12 mails de Carrefour ?')"
}

Règles :
- "supprime/efface/jette ce mail" → action_type="delete_current_email" (seulement si un mail est ouvert).
- "supprime/efface tous les mails de X", "supprime les mails commerciaux de X" → action_type="delete_emails_by_sender", sender=fragment exact.
- "archive le thème X", "archive les mails du thème X", "archive le sujet X" → action_type="archive_theme_emails", theme_name=nom du thème (le plus proche de la liste).
- Toute autre demande, question ou flou → kind="reply" avec une réponse courte expliquant ce que tu peux faire ou demandant une précision.
- N'invente jamais : si tu ne peux pas matcher l'action avec confiance, kind="reply".

Contexte :
${currentEmailInfo || "Aucun mail actuellement ouvert."}
Thèmes disponibles : ${themes.map((t) => t.name).join(", ") || "(aucun)"}.`;

    const resp = await callGateway(key, {
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: data.prompt },
      ],
      response_format: { type: "json_object" },
    });
    const raw = resp?.choices?.[0]?.message?.content ?? "{}";
    let parsed: z.infer<typeof PlanSchema>;
    try {
      parsed = PlanSchema.parse(JSON.parse(raw));
    } catch {
      parsed = PlanSchema.parse({});
    }

    if (parsed.kind === "reply" || parsed.action_type === "none") {
      return { kind: "reply", reply: parsed.reply || "Je n'ai pas compris l'action. Peux-tu reformuler ?" };
    }

    // Construire l'aperçu selon le type d'action
    if (parsed.action_type === "delete_current_email") {
      if (!data.currentEmailId) {
        return { kind: "reply", reply: "Aucun mail n'est ouvert actuellement. Ouvre d'abord le mail à supprimer." };
      }
      const { data: e } = await supabase
        .from("emails")
        .select("id,subject,from_address,from_name,received_at")
        .eq("id", data.currentEmailId)
        .maybeSingle();
      if (!e) return { kind: "reply", reply: "Mail introuvable." };
      return {
        kind: "action",
        actionType: "delete_current_email",
        params: { emailId: data.currentEmailId },
        preview: {
          count: 1,
          samples: [{ id: e.id, subject: e.subject ?? "(sans objet)", from: e.from_name ?? e.from_address ?? "", date: e.received_at }],
        },
        confirmationMessage: parsed.confirmation_message || `Supprimer le mail "${e.subject ?? "(sans objet)"}" ?`,
        destructive: true,
      };
    }

    if (parsed.action_type === "delete_emails_by_sender") {
      const sender = parsed.sender.trim();
      if (!sender) return { kind: "reply", reply: "Précise l'expéditeur à supprimer." };
      const { data: rows } = await supabase
        .from("emails")
        .select("id,subject,from_address,from_name,received_at")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .or(`from_address.ilike.%${sender}%,from_name.ilike.%${sender}%`)
        .order("received_at", { ascending: false })
        .limit(500);
      const list = rows ?? [];
      if (list.length === 0) return { kind: "reply", reply: `Aucun mail trouvé pour "${sender}".` };
      return {
        kind: "action",
        actionType: "delete_emails_by_sender",
        params: { sender },
        preview: {
          count: list.length,
          samples: list.slice(0, 5).map((e) => ({ id: e.id, subject: e.subject ?? "(sans objet)", from: e.from_name ?? e.from_address ?? "", date: e.received_at })),
        },
        confirmationMessage: parsed.confirmation_message || `Supprimer ${list.length} mail(s) de "${sender}" ?`,
        destructive: true,
      };
    }

    if (parsed.action_type === "archive_theme_emails") {
      const wanted = parsed.theme_name.trim().toLowerCase();
      if (!wanted || themes.length === 0) return { kind: "reply", reply: "Précise le thème à archiver." };
      // Match: exact (insensible casse/accents) puis includes
      const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
      const target = themes.find((t) => norm(t.name) === norm(wanted)) ?? themes.find((t) => norm(t.name).includes(norm(wanted))) ?? null;
      if (!target) return { kind: "reply", reply: `Thème "${parsed.theme_name}" introuvable.` };
      const { data: rows } = await supabase
        .from("emails")
        .select("id,subject,from_address,from_name,received_at")
        .eq("user_id", userId)
        .eq("theme_id", target.id)
        .is("deleted_at", null)
        .eq("is_archived", false)
        .order("received_at", { ascending: false })
        .limit(500);
      const list = rows ?? [];
      if (list.length === 0) return { kind: "reply", reply: `Aucun mail à archiver dans le thème "${target.name}".` };
      return {
        kind: "action",
        actionType: "archive_theme_emails",
        params: { themeId: target.id, themeName: target.name },
        preview: {
          count: list.length,
          samples: list.slice(0, 5).map((e) => ({ id: e.id, subject: e.subject ?? "(sans objet)", from: e.from_name ?? e.from_address ?? "", date: e.received_at })),
        },
        confirmationMessage: parsed.confirmation_message || `Archiver ${list.length} mail(s) du thème "${target.name}" ?`,
        destructive: false,
      };
    }

    return { kind: "reply", reply: "Action non supportée." };
  });

// ─── EXECUTE ────────────────────────────────────────────────────────────────

const ExecInput = z.object({
  actionType: z.enum(["delete_current_email", "delete_emails_by_sender", "archive_theme_emails"]),
  emailId: z.string().uuid().nullable().optional(),
  sender: z.string().max(200).nullable().optional(),
  themeId: z.string().uuid().nullable().optional(),
});

export const aiVoiceCommandExecute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ExecInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; count: number; message: string }> => {
    const { supabase, userId } = context;
    const now = new Date().toISOString();

    if (data.actionType === "delete_current_email") {
      if (!data.emailId) throw new Error("emailId manquant");
      const { error } = await supabase
        .from("emails")
        .update({ deleted_at: now })
        .eq("id", data.emailId)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { ok: true, count: 1, message: "Mail supprimé." };
    }

    if (data.actionType === "delete_emails_by_sender") {
      const sender = (data.sender ?? "").trim();
      if (!sender) throw new Error("sender manquant");
      const { data: rows, error: selErr } = await supabase
        .from("emails")
        .select("id")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .or(`from_address.ilike.%${sender}%,from_name.ilike.%${sender}%`);
      if (selErr) throw new Error(selErr.message);
      const ids = (rows ?? []).map((r) => r.id);
      if (ids.length === 0) return { ok: true, count: 0, message: "Aucun mail." };
      const { error } = await supabase
        .from("emails")
        .update({ deleted_at: now })
        .in("id", ids)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { ok: true, count: ids.length, message: `${ids.length} mail(s) supprimé(s).` };
    }

    if (data.actionType === "archive_theme_emails") {
      if (!data.themeId) throw new Error("themeId manquant");
      const { data: rows, error: selErr } = await supabase
        .from("emails")
        .select("id")
        .eq("user_id", userId)
        .eq("theme_id", data.themeId)
        .is("deleted_at", null)
        .eq("is_archived", false);
      if (selErr) throw new Error(selErr.message);
      const ids = (rows ?? []).map((r) => r.id);
      if (ids.length === 0) return { ok: true, count: 0, message: "Aucun mail à archiver." };
      const { error } = await supabase
        .from("emails")
        .update({ is_archived: true })
        .in("id", ids)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { ok: true, count: ids.length, message: `${ids.length} mail(s) archivé(s).` };
    }

    throw new Error("Action non supportée");
  });
