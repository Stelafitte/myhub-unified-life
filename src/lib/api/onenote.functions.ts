import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/microsoft_onenote";

function gwHeaders() {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.MICROSOFT_ONENOTE_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY manquant");
  if (!connKey) throw new Error("OneNote non connecté — ajoute le connecteur Microsoft OneNote.");
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
  };
}

export type OneNoteNotebook = { id: string; displayName: string };
export type OneNoteSection = { id: string; displayName: string };

export const listOneNoteNotebooks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const r = await fetch(`${GATEWAY_URL}/me/onenote/notebooks?$select=id,displayName`, {
      headers: gwHeaders(),
    });
    if (!r.ok) throw new Error(`OneNote ${r.status}: ${await r.text().catch(() => "")}`);
    const j = (await r.json()) as { value?: OneNoteNotebook[] };
    return { notebooks: j.value ?? [] };
  });

export const listOneNoteSections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ notebookId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const r = await fetch(
      `${GATEWAY_URL}/me/onenote/notebooks/${data.notebookId}/sections?$select=id,displayName`,
      { headers: gwHeaders() },
    );
    if (!r.ok) throw new Error(`OneNote ${r.status}: ${await r.text().catch(() => "")}`);
    const j = (await r.json()) as { value?: OneNoteSection[] };
    return { sections: j.value ?? [] };
  });

export const testOneNoteConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const r = await fetch(`${GATEWAY_URL}/me/onenote/notebooks?$top=1`, { headers: gwHeaders() });
    if (!r.ok) {
      return { ok: false, message: `HTTP ${r.status}` };
    }
    return { ok: true, message: "Connexion OneNote valide" };
  });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type MeetingSyncInput = {
  meetingId: string;
};

export const syncMeetingToOneNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ meetingId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const [{ data: meeting, error: mErr }, { data: settings }, { data: participants }, { data: agenda }] =
      await Promise.all([
        supabase.from("meetings").select("*").eq("id", data.meetingId).eq("user_id", userId).maybeSingle(),
        supabase
          .from("meeting_settings")
          .select("onenote_notebook_id, onenote_section_id")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("meeting_participants")
          .select("name, email, role, rsvp_status")
          .eq("meeting_id", data.meetingId),
        supabase
          .from("meeting_agenda_items")
          .select("title, duration_minutes, responsible_name, status")
          .eq("meeting_id", data.meetingId)
          .order("position", { ascending: true }),
      ]);

    if (mErr || !meeting) throw new Error("Réunion introuvable");

    const dateStr = new Date(meeting.start_at).toLocaleString("fr-FR", {
      dateStyle: "full",
      timeStyle: "short",
    });

    const participantsHtml = (participants ?? [])
      .map(
        (p) =>
          `<li>${escapeHtml(p.name ?? p.email)} <em>(${escapeHtml(p.role)} – ${escapeHtml(
            p.rsvp_status,
          )})</em></li>`,
      )
      .join("");

    const agendaHtml = (agenda ?? [])
      .map(
        (a) =>
          `<li><strong>${escapeHtml(a.title)}</strong> – ${a.duration_minutes} min${
            a.responsible_name ? ` (${escapeHtml(a.responsible_name)})` : ""
          } – <em>${escapeHtml(a.status)}</em></li>`,
      )
      .join("");

    const title = escapeHtml(meeting.title);
    const html = `<!DOCTYPE html>
<html>
  <head>
    <title>${title}</title>
    <meta name="created" content="${new Date().toISOString()}" />
  </head>
  <body>
    <h1>${title}</h1>
    <p><strong>Date :</strong> ${escapeHtml(dateStr)}</p>
    ${meeting.location ? `<p><strong>Lieu :</strong> ${escapeHtml(meeting.location)}</p>` : ""}
    ${meeting.room ? `<p><strong>Salle :</strong> ${escapeHtml(meeting.room)}</p>` : ""}
    ${meeting.online_link ? `<p><strong>Lien :</strong> <a href="${escapeHtml(meeting.online_link)}">${escapeHtml(meeting.online_link)}</a></p>` : ""}
    ${meeting.description ? `<h2>Description</h2><p>${escapeHtml(meeting.description)}</p>` : ""}
    <h2>Participants</h2>
    <ul>${participantsHtml || "<li><em>Aucun</em></li>"}</ul>
    <h2>Ordre du jour</h2>
    <ul>${agendaHtml || "<li><em>Aucun</em></li>"}</ul>
    ${meeting.notes ? `<h2>Notes</h2><div>${meeting.notes.replace(/\n/g, "<br/>")}</div>` : ""}
    ${meeting.decisions ? `<h2>Décisions</h2><div>${meeting.decisions.replace(/\n/g, "<br/>")}</div>` : ""}
  </body>
</html>`;

    const existingPageId = meeting.onenote_page_id as string | null;

    if (existingPageId) {
      // Replace body content via PATCH
      const patchRes = await fetch(`${GATEWAY_URL}/me/onenote/pages/${existingPageId}/content`, {
        method: "PATCH",
        headers: { ...gwHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify([
          { target: "body", action: "replace", content: html },
        ]),
      });
      if (!patchRes.ok) {
        const errText = await patchRes.text().catch(() => "");
        // If the page is gone, fall through to create a new one
        if (patchRes.status !== 404) {
          throw new Error(`OneNote PATCH ${patchRes.status}: ${errText}`);
        }
      } else {
        await supabase
          .from("meetings")
          .update({ onenote_synced_at: new Date().toISOString() })
          .eq("id", data.meetingId);
        return { ok: true, pageId: existingPageId, pageUrl: meeting.onenote_page_url };
      }
    }

    const sectionId = settings?.onenote_section_id as string | null;
    const createUrl = sectionId
      ? `${GATEWAY_URL}/me/onenote/sections/${sectionId}/pages`
      : `${GATEWAY_URL}/me/onenote/pages`;

    const createRes = await fetch(createUrl, {
      method: "POST",
      headers: { ...gwHeaders(), "Content-Type": "text/html" },
      body: html,
    });
    if (!createRes.ok) {
      throw new Error(`OneNote POST ${createRes.status}: ${await createRes.text().catch(() => "")}`);
    }
    const page = (await createRes.json()) as { id: string; links?: { oneNoteWebUrl?: { href?: string } } };
    const pageUrl = page.links?.oneNoteWebUrl?.href ?? null;

    await supabase
      .from("meetings")
      .update({
        onenote_page_id: page.id,
        onenote_page_url: pageUrl,
        onenote_synced_at: new Date().toISOString(),
      })
      .eq("id", data.meetingId);

    return { ok: true, pageId: page.id, pageUrl };
  });
