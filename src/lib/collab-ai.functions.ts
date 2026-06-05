import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const EDITORIAL_ACTIONS = [
  "improve",
  "shorten",
  "lengthen",
  "simplify",
  "fix_grammar",
  "change_tone",
  "translate",
  "summarize",
  "to_bullets",
  "continue",
] as const;

export type EditorialAction = (typeof EDITORIAL_ACTIONS)[number];

const InputSchema = z.object({
  action: z.enum(EDITORIAL_ACTIONS),
  text: z.string().min(1).max(20_000),
  // Optional params per action
  tone: z.string().max(80).optional(),
  language: z.string().max(80).optional(),
  contextBefore: z.string().max(4000).optional(),
});

function buildPrompt(input: z.infer<typeof InputSchema>): { sys: string; user: string } {
  const base =
    "Tu es un assistant éditorial. Tu réponds UNIQUEMENT avec le texte transformé, sans préambule, sans guillemets, sans markdown de bloc de code. Conserve la langue d'origine sauf si on te demande de traduire.";
  let instruction = "";
  switch (input.action) {
    case "improve":
      instruction = "Améliore ce texte : clarté, fluidité, style. Garde le sens et la longueur globale.";
      break;
    case "shorten":
      instruction = "Réécris ce texte en le raccourcissant nettement (~50%) sans perdre l'essentiel.";
      break;
    case "lengthen":
      instruction = "Développe ce texte en l'enrichissant de détails utiles, sans inventer de faits.";
      break;
    case "simplify":
      instruction = "Simplifie ce texte : vocabulaire accessible, phrases courtes.";
      break;
    case "fix_grammar":
      instruction = "Corrige uniquement l'orthographe, la grammaire et la ponctuation. Ne change ni le style ni le sens.";
      break;
    case "change_tone":
      instruction = `Réécris ce texte avec le ton suivant : ${input.tone || "professionnel"}. Garde le sens.`;
      break;
    case "translate":
      instruction = `Traduis ce texte en ${input.language || "anglais"}. Rends uniquement la traduction.`;
      break;
    case "summarize":
      instruction = "Résume ce texte en un paragraphe court qui en restitue les points clés.";
      break;
    case "to_bullets":
      instruction = "Transforme ce texte en liste à puces concise (une idée par puce, commencer chaque puce par '- ').";
      break;
    case "continue":
      instruction =
        "Continue le texte dans la même langue, le même ton et le même style. Produis 1 à 3 phrases supplémentaires cohérentes. Ne répète pas le texte fourni.";
      break;
  }
  const ctx = input.contextBefore
    ? `\n\nContexte précédent (pour le style, ne pas répéter) :\n${input.contextBefore.slice(-2000)}`
    : "";
  return {
    sys: base,
    user: `${instruction}${ctx}\n\nTexte :\n${input.text}`,
  };
}

export const runEditorialAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    const { sys, user } = buildPrompt(data);

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
    });

    if (resp.status === 429) {
      throw new Error("Limite IA atteinte, réessaie dans un instant.");
    }
    if (resp.status === 402) {
      throw new Error("Crédits IA épuisés. Ajoute des crédits dans Paramètres.");
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`AI gateway: ${resp.status} ${text.slice(0, 200)}`);
    }

    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const output = (json?.choices?.[0]?.message?.content ?? "").trim();
    if (!output) throw new Error("Réponse IA vide");

    return {
      action: data.action,
      original: data.text,
      suggestion: output,
    };
  });
