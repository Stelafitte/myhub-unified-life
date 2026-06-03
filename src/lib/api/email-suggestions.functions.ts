import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ emailId: z.string().uuid() });

export type EmailSuggestions = {
  replies: { label: string; text: string }[];
  event: {
    title: string;
    start: string;
    end: string | null;
    location: string | null;
    onlineLink: string | null;
    description: string | null;
  } | null;
  archiveSuggested: boolean;
  taskTitle: string | null;
};

export const getEmailSuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<EmailSuggestions> => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    const { data: e, error } = await supabase
      .from("emails")
      .select("id,subject,from_address,from_name,body_text,body_html,received_at,ai_category,is_sensitive,meeting_link")
      .eq("id", data.emailId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!e) {
      return { replies: [], event: null, archiveSuggested: false, taskTitle: null };
    }
    if (e.is_sensitive) {
      throw new Error("Email marqué sensible (HDS) — analyse IA désactivée pour protection des données de santé.");
    }

    const today = new Date().toISOString();
    const tz = "Europe/Paris";
    const offsetStr = getZoneOffsetString(tz);
    const bodyText = e.body_text ?? "";
    const bodyHtml = (e as any).body_html ?? "";
    // Détection systématique de liens de réunion en ligne (champ stocké en priorité, fallback regex)
    const linkRegex = /https?:\/\/(?:[a-z0-9-]+\.)?(?:zoom\.us|teams\.microsoft\.com|teams\.live\.com|meet\.google\.com|webex\.com|gotomeeting\.com|whereby\.com|meet\.jit\.si|bluejeans\.com|chime\.aws|8x8\.vc|around\.co)\/[^\s"'<>)]+/i;
    const detectedLink =
      (e as any).meeting_link ??
      bodyText.match(linkRegex)?.[0] ??
      bodyHtml.match(linkRegex)?.[0] ??
      null;

    // Récupère tous les événements futurs de l'agenda (pas de fenêtre fixe) pour
    // vérifier la disponibilité aux dates effectivement proposées dans l'email.
    const horizonStart = new Date();
    const { data: busyEvents } = await supabase
      .from("calendar_events")
      .select("title,start_at,end_at,is_all_day")
      .eq("user_id", userId)
      .gte("end_at", horizonStart.toISOString())
      .order("start_at", { ascending: true })
      .limit(500);

    const busySlots = (busyEvents ?? [])
      .map((ev) => {
        const s = new Date(ev.start_at).toLocaleString("fr-FR", { timeZone: tz, dateStyle: "short", timeStyle: "short" });
        const en = new Date(ev.end_at).toLocaleString("fr-FR", { timeZone: tz, dateStyle: "short", timeStyle: "short" });
        return `- ${s} → ${en}${ev.is_all_day ? " (journée)" : ""} : ${ev.title ?? ""}`;
      })
      .join("\n");

    const sys = `Tu analyses un email pour proposer des actions. Réponds UNIQUEMENT en JSON valide:
{
  "replies": [
    {"label":"Accusé de réception","text":"réponse courte polie en français"},
    {"label":"Engagement","text":"réponse avec engagement sur une date/délai"},
    {"label":"Délai poli","text":"réponse demandant un délai ou déclinant poliment"}
  ],
  "event": null OU {"title":"...","start":"ISO8601","end":"ISO8601 ou null","location":"lieu physique ou null","online_link":"URL réunion en ligne (Zoom/Teams/Meet) ou null","description":"résumé court de l'ordre du jour ou null"},
  "archive_suggested": true|false,
  "task_title": "titre actionnable court ou null si aucune action"
}
Date de référence: ${today}. Fuseau horaire de l'utilisateur: ${tz} (offset UTC ${offsetStr}).
IMPORTANT: les heures mentionnées dans l'email sont en heure locale de l'utilisateur (${tz}).
Pour "start" et "end", retourne un ISO8601 AVEC l'offset local exact (ex: 2026-06-02T19:00:00${offsetStr}).
N'utilise JAMAIS le suffixe "Z" ni un offset différent de ${offsetStr}, sauf si l'email mentionne explicitement un autre fuseau.
Détecte une date/heure de réunion explicite pour "event".
Si l'email contient un lien Zoom/Teams/Meet/Webex, inclus-le dans "online_link".
"archive_suggested" = true si newsletter, notif auto, publicité.

VÉRIFICATION DISPONIBILITÉ AGENDA (CRUCIAL) :
Liste complète des créneaux OCCUPÉS à venir de l'utilisateur (heure locale ${tz}) :
${busySlots || "(aucun événement, agenda libre)"}

Procédure obligatoire avant toute proposition de créneau :
1. Identifier dans l'email TOUTES les dates/heures proposées par l'expéditeur, quelle que soit l'échéance.
2. Pour CHAQUE date proposée, vérifier le chevauchement avec la liste ci-dessus.
   - Si LIBRE : confirmer (ex. "Je suis disponible jeudi 5 juin à 18h30, c'est noté.").
   - Si OCCUPÉ : décliner poliment en indiquant le conflit, et proposer 2 alternatives libres proches de la date demandée.
3. NE JAMAIS proposer ni accepter un créneau qui chevauche un événement de la liste.
4. Respecter les heures ouvrées par défaut (lun-ven, 9h-19h) sauf indication contraire dans l'email.
5. Si tu proposes un créneau de ta propre initiative, ajouter "(créneau vérifié libre dans mon agenda)".

Les réponses doivent être en français, signées avec "Cordialement".`;

    const user = `Sujet: ${e.subject ?? ""}
De: ${e.from_name ?? ""} <${e.from_address ?? ""}>
Reçu: ${e.received_at ?? ""}

${bodyText.slice(0, 3500)}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`AI gateway: ${resp.status} ${t.slice(0, 200)}`);
    }
    const json = await resp.json();
    const raw = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: {
      replies?: { label?: string; text?: string }[];
      event?: {
        title?: string;
        start?: string;
        end?: string | null;
        location?: string | null;
        online_link?: string | null;
        description?: string | null;
      } | null;
      archive_suggested?: boolean;
      task_title?: string | null;
    } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* keep empty */
    }

    const replies = (parsed.replies ?? [])
      .filter((r) => r?.text)
      .slice(0, 3)
      .map((r) => ({ label: r.label || "Réponse", text: String(r.text) }));

    let event: EmailSuggestions["event"] = null;
    if (parsed.event && parsed.event.start && parsed.event.title) {
      event = {
        title: String(parsed.event.title),
        start: String(parsed.event.start),
        end: parsed.event.end ? String(parsed.event.end) : null,
        location: parsed.event.location ? String(parsed.event.location) : null,
        onlineLink: parsed.event.online_link ? String(parsed.event.online_link) : detectedLink,
        description: parsed.event.description ? String(parsed.event.description) : null,
      };
    }


    return {
      replies,
      event,
      archiveSuggested: Boolean(parsed.archive_suggested) || e.ai_category === "newsletter",
      taskTitle: parsed.task_title ? String(parsed.task_title).slice(0, 120) : null,
    };
  });
