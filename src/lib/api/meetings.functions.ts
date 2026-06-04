import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadActivePromptsBlock } from "./_ai-prompts";

/* ------------------------------------------------------------------ */
/* Google token refresh (local copy to avoid cross-file server import) */
/* ------------------------------------------------------------------ */

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: string }> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google Calendar OAuth client is not configured.");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(
      `Refresh token failed (${res.status}): ${body.error_description ?? body.error ?? "unknown"}`,
    );
  }
  return {
    accessToken: body.access_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Timezone helpers (DST-aware, server runs UTC)                      */
/* ------------------------------------------------------------------ */

function tzParts(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const wdMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    da: Number(parts.day),
    h: Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    mi: Number(parts.minute),
    isoWeekday: wdMap[parts.weekday] ?? 1,
  };
}

function parisWallToUtc(y: number, mo: number, da: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  const back = tzParts(new Date(guess), tz);
  const wallUtc = Date.UTC(back.y, back.mo - 1, back.da, back.h, back.mi);
  const offset = wallUtc - guess;
  return new Date(guess - offset);
}

function parisMidnight(d: Date, tz: string): Date {
  const p = tzParts(d, tz);
  return parisWallToUtc(p.y, p.mo, p.da, 0, 0, tz);
}

function parisYMD(d: Date, tz: string) {
  return tzParts(d, tz);
}

function parisHour(d: Date, tz: string): number {
  return tzParts(d, tz).h;
}

/* ------------------------------------------------------------------ */
/* Slot finder                                                        */
/* ------------------------------------------------------------------ */

export type AvailableSlot = {
  startAt: string; // ISO
  endAt: string;   // ISO
  period: "morning" | "afternoon";
  score: number;   // higher = better
  ideal: boolean;
};

const findSlotsInput = z.object({
  durationMinutes: z.number().int().min(15).max(8 * 60).default(60),
  daysAhead: z.number().int().min(1).max(60).default(30),
  leadHours: z.number().int().min(0).max(7 * 24).default(24),
  workStartHour: z.number().int().min(0).max(23).default(8),
  workEndHour: z.number().int().min(1).max(24).default(19),
  // 1 = Monday … 7 = Sunday (ISO). Default: Mon-Fri.
  workDays: z.array(z.number().int().min(1).max(7)).default([1, 2, 3, 4, 5]),
  maxResults: z.number().int().min(1).max(20).default(5),
});

type Busy = { start: number; end: number };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Find the N best available meeting slots by querying the user's Google
 * Calendar freebusy. Falls back to "all working hours free" when no GCal
 * connection is linked (still respects work hours / lead time).
 */
export const findAvailableSlots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => findSlotsInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };

    const now = Date.now();
    const earliest = now + data.leadHours * 3600_000;
    const horizonEnd = now + data.daysAhead * 86400_000;

    /* ---------- Collect busy intervals from all active GCal connections ---------- */
    const busy: Busy[] = [];

    const { data: connections } = await supabaseAdmin
      .from("google_calendar_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true);

    for (const conn of connections ?? []) {
      let accessToken = conn.access_token as string;
      if (new Date(conn.expires_at).getTime() < Date.now() + 60_000) {
        try {
          const refreshed = await refreshAccessToken(conn.refresh_token);
          accessToken = refreshed.accessToken;
          await supabaseAdmin
            .from("google_calendar_connections")
            .update({ access_token: accessToken, expires_at: refreshed.expiresAt })
            .eq("id", conn.id);
        } catch (e) {
          console.error("freebusy: refresh failed", conn.id, e);
          continue;
        }
      }

      try {
        const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            timeMin: new Date(now).toISOString(),
            timeMax: new Date(horizonEnd).toISOString(),
            items: [{ id: conn.calendar_id || "primary" }],
          }),
        });
        if (!res.ok) {
          console.warn("freebusy non-ok", res.status);
          continue;
        }
        const body = (await res.json()) as {
          calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
        };
        for (const cal of Object.values(body.calendars ?? {})) {
          for (const b of cal.busy ?? []) {
            busy.push({
              start: new Date(b.start).getTime(),
              end: new Date(b.end).getTime(),
            });
          }
        }
      } catch (e) {
        console.warn("freebusy fetch failed", e);
      }
    }

    /* ---------- Also include meetings already stored locally ---------- */
    const { data: localMeetings } = await supabaseAdmin
      .from("meetings")
      .select("start_at, end_at, status")
      .eq("user_id", userId)
      .neq("status", "cancelled")
      .gte("end_at", new Date(now).toISOString())
      .lte("start_at", new Date(horizonEnd).toISOString());

    for (const m of localMeetings ?? []) {
      busy.push({
        start: new Date(m.start_at).getTime(),
        end: new Date(m.end_at).getTime(),
      });
    }

    // Merge overlapping busy intervals
    busy.sort((a, b) => a.start - b.start);
    const merged: Busy[] = [];
    for (const b of busy) {
      const last = merged[merged.length - 1];
      if (last && b.start <= last.end) {
        last.end = Math.max(last.end, b.end);
      } else {
        merged.push({ ...b });
      }
    }

    /* ---------- Walk each working day, propose slots in 30-min steps ---------- */
    const durationMs = data.durationMinutes * 60_000;
    const step = 30 * 60_000;
    const results: AvailableSlot[] = [];

    function isBusy(start: number, end: number): boolean {
      for (const b of merged) {
        if (b.end <= start) continue;
        if (b.start >= end) break;
        return true;
      }
      return false;
    }

    const workDays = new Set(data.workDays);
    const TZ = "Europe/Paris";
    const startDay = parisMidnight(new Date(earliest), TZ);

    for (let d = 0; d <= data.daysAhead; d++) {
      const dayRef = new Date(startDay.getTime() + d * 86400_000 + 12 * 3600_000);
      const { y, mo, da, isoWeekday } = parisYMD(dayRef, TZ);
      if (!workDays.has(isoWeekday)) continue;

      const dayStartMs = parisWallToUtc(y, mo, da, data.workStartHour, 0, TZ).getTime();
      const dayEndMs = parisWallToUtc(y, mo, da, clamp(data.workEndHour, 1, 24), 0, TZ).getTime();

      for (let t = dayStartMs; t + durationMs <= dayEndMs; t += step) {
        if (t < earliest) continue;
        const endT = t + durationMs;
        if (isBusy(t, endT)) continue;

        const startH = parisHour(new Date(t), TZ);
        const period: "morning" | "afternoon" = startH < 12 ? "morning" : "afternoon";
        // Ideal windows: 10-12 and 14-16
        const ideal = (startH >= 10 && startH < 12) || (startH >= 14 && startH < 16);
        // Score: closer to ideal windows + earlier in the horizon wins.
        let score = 100;
        if (ideal) score += 50;
        if (startH < 9 || startH >= 17) score -= 30;
        score -= d; // prefer sooner
        results.push({
          startAt: new Date(t).toISOString(),
          endAt: new Date(endT).toISOString(),
          period,
          score,
          ideal,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);

    // Deduplicate: don't propose two slots within the same 2h window.
    const picked: AvailableSlot[] = [];
    for (const s of results) {
      if (picked.length >= data.maxResults) break;
      const ts = new Date(s.startAt).getTime();
      if (picked.some((p) => Math.abs(new Date(p.startAt).getTime() - ts) < 2 * 3600_000)) {
        continue;
      }
      picked.push(s);
    }

    // Re-sort the final picks chronologically for display.
    picked.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

    return {
      slots: picked,
      hasGoogleCalendar: (connections?.length ?? 0) > 0,
      busyIntervals: merged.length,
    };
  });

/* ------------------------------------------------------------------ */
/* AI slot proposal: rank free slots against user-provided constraints */
/* ------------------------------------------------------------------ */

export type AiProposedSlot = {
  startAt: string;
  endAt: string;
  reason: string;
};

const aiProposeInput = z.object({
  constraints: z.string().min(1).max(2000),
  durationMinutes: z.number().int().min(15).max(8 * 60).default(60),
  daysAhead: z.number().int().min(1).max(60).default(30),
  leadHours: z.number().int().min(0).max(7 * 24).default(24),
  maxResults: z.number().int().min(1).max(8).default(5),
});

export const aiProposeSlots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => aiProposeInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY manquant");
    const { userId, supabase } = context as { userId: string; supabase: unknown };
    const userPromptsBlock = await loadActivePromptsBlock(supabase, userId, ["meeting_slots", "meeting"]);

    // Reuse the slot finder logic by calling its handler-equivalent directly.
    // Generate a wide candidate set (up to 20 slots) for the AI to choose from.
    const candidates = await findCandidateSlots(userId, {
      durationMinutes: data.durationMinutes,
      daysAhead: data.daysAhead,
      leadHours: data.leadHours,
      maxResults: 20,
    });

    if (candidates.slots.length === 0) {
      return { slots: [] as AiProposedSlot[], hasGoogleCalendar: candidates.hasGoogleCalendar, raw: "" };
    }

    const slotList = candidates.slots.map((s, i) => {
      const fmtDay = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "2-digit", month: "long" });
      const fmtTime = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false });
      const day = fmtDay.format(new Date(s.startAt));
      const hours = `${fmtTime.format(new Date(s.startAt))}–${fmtTime.format(new Date(s.endAt))}`;
      return `${i + 1}. ${day} ${hours} (Europe/Paris, period=${s.period}) [startAt=${s.startAt}, endAt=${s.endAt}]`;
    }).join("\n");

    const today = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "2-digit", month: "long", year: "numeric" });

    const system = `Tu es un assistant de planification rigoureux. Tu reçois (1) une liste de créneaux libres dans le calendrier de l'utilisateur, affichés en heure de Paris (Europe/Paris), et (2) un texte libre en français qui peut contenir DEUX types d'informations à distinguer :
- DISPONIBILITÉS (positif, ex : "dispo les après-midis de 15h à 18h", "uniquement mardi ou jeudi", "le matin entre 9h et 11h") — ce sont des fenêtres EXCLUSIVES : tout créneau hors de ces fenêtres doit être éliminé.
- CONTRAINTES (négatif, ex : "pas le lundi", "éviter avant 9h", "sauf le week-end") — ce sont des exclusions : éliminer tout créneau qui les enfreint.

Règles strictes :
1. Identifie d'abord les disponibilités exprimées. Si l'utilisateur précise une plage horaire (ex "15h à 18h"), un créneau N'EST RETENU QUE SI son heure de début ET son heure de fin sont entièrement dans cette plage en heure de Paris.
2. Applique ensuite les contraintes (exclusions).
3. Ne choisis QUE parmi les créneaux fournis. N'invente jamais de startAt/endAt.
4. Si aucun créneau ne respecte les disponibilités ET les contraintes, renvoie {"slots":[]} — ne propose surtout pas un créneau approximatif.
5. Classe les retenus du meilleur au moins bon, max ${data.maxResults}.

Réponds UNIQUEMENT en JSON valide, sans markdown : {"slots":[{"startAt":"ISO exact copié","endAt":"ISO exact copié","reason":"courte explication en français citant la disponibilité/contrainte respectée"}]}.${userPromptsBlock}`;

    const user = `Date d'aujourd'hui (Paris) : ${today}\n\nTexte utilisateur (contraintes et disponibilités à analyser) :\n"""\n${data.constraints}\n"""\n\nCréneaux libres candidats (heures en Europe/Paris) :\n${slotList}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Limite de requêtes IA atteinte, réessayez dans un instant.");
      if (res.status === 402) throw new Error("Crédits IA épuisés. Ajoutez du crédit dans Paramètres → Workspace.");
      throw new Error(`Erreur IA (${res.status}): ${body.slice(0, 200)}`);
    }

    const payload = await res.json() as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content ?? "";
    let parsed: { slots?: AiProposedSlot[] } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Réponse IA invalide.");
    }

    // Validate: only keep slots whose startAt exists in candidates.
    const allowed = new Set(candidates.slots.map((s) => s.startAt));
    const slots = (parsed.slots ?? [])
      .filter((s) => s && typeof s.startAt === "string" && allowed.has(s.startAt))
      .slice(0, data.maxResults)
      .map((s) => ({
        startAt: s.startAt,
        endAt: s.endAt,
        reason: typeof s.reason === "string" ? s.reason.slice(0, 300) : "",
      }));

    return { slots, hasGoogleCalendar: candidates.hasGoogleCalendar, raw };
  });

/* Internal helper that mirrors findAvailableSlots but can be called from
 * another server function without the createServerFn RPC overhead. */
async function findCandidateSlots(
  userId: string,
  opts: { durationMinutes: number; daysAhead: number; leadHours: number; maxResults: number },
): Promise<{ slots: AvailableSlot[]; hasGoogleCalendar: boolean }> {
  const workStartHour = 8;
  const workEndHour = 19;
  const workDays = new Set([1, 2, 3, 4, 5]);

  const now = Date.now();
  const earliest = now + opts.leadHours * 3600_000;
  const horizonEnd = now + opts.daysAhead * 86400_000;

  const busy: Busy[] = [];
  const { data: connections } = await supabaseAdmin
    .from("google_calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true);

  for (const conn of connections ?? []) {
    let accessToken = conn.access_token as string;
    if (new Date(conn.expires_at).getTime() < Date.now() + 60_000) {
      try {
        const refreshed = await refreshAccessToken(conn.refresh_token);
        accessToken = refreshed.accessToken;
        await supabaseAdmin
          .from("google_calendar_connections")
          .update({ access_token: accessToken, expires_at: refreshed.expiresAt })
          .eq("id", conn.id);
      } catch { continue; }
    }
    try {
      const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          timeMin: new Date(now).toISOString(),
          timeMax: new Date(horizonEnd).toISOString(),
          items: [{ id: conn.calendar_id || "primary" }],
        }),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { calendars?: Record<string, { busy?: { start: string; end: string }[] }> };
      for (const cal of Object.values(body.calendars ?? {})) {
        for (const b of cal.busy ?? []) {
          busy.push({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() });
        }
      }
    } catch { /* skip */ }
  }

  const { data: localMeetings } = await supabaseAdmin
    .from("meetings")
    .select("start_at, end_at, status")
    .eq("user_id", userId)
    .neq("status", "cancelled")
    .gte("end_at", new Date(now).toISOString())
    .lte("start_at", new Date(horizonEnd).toISOString());
  for (const m of localMeetings ?? []) {
    busy.push({ start: new Date(m.start_at).getTime(), end: new Date(m.end_at).getTime() });
  }

  busy.sort((a, b) => a.start - b.start);
  const merged: Busy[] = [];
  for (const b of busy) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ ...b });
  }

  const durationMs = opts.durationMinutes * 60_000;
  const step = 30 * 60_000;
  const results: AvailableSlot[] = [];
  function isBusy(start: number, end: number): boolean {
    for (const b of merged) {
      if (b.end <= start) continue;
      if (b.start >= end) break;
      return true;
    }
    return false;
  }
  const TZ = "Europe/Paris";
  const startDay = parisMidnight(new Date(earliest), TZ);
  for (let d = 0; d <= opts.daysAhead; d++) {
    const dayRef = new Date(startDay.getTime() + d * 86400_000 + 12 * 3600_000); // noon to avoid DST edge
    const { y, mo, da, isoWeekday } = parisYMD(dayRef, TZ);
    if (!workDays.has(isoWeekday)) continue;
    const dayStartMs = parisWallToUtc(y, mo, da, workStartHour, 0, TZ).getTime();
    const dayEndMs = parisWallToUtc(y, mo, da, workEndHour, 0, TZ).getTime();
    for (let t = dayStartMs; t + durationMs <= dayEndMs; t += step) {
      if (t < earliest) continue;
      const endT = t + durationMs;
      if (isBusy(t, endT)) continue;
      const startH = parisHour(new Date(t), TZ);
      const period: "morning" | "afternoon" = startH < 12 ? "morning" : "afternoon";
      const ideal = (startH >= 10 && startH < 12) || (startH >= 14 && startH < 16);
      let score = 100;
      if (ideal) score += 50;
      if (startH < 9 || startH >= 17) score -= 30;
      score -= d;
      results.push({ startAt: new Date(t).toISOString(), endAt: new Date(endT).toISOString(), period, score, ideal });
    }
  }
  results.sort((a, b) => b.score - a.score);
  const picked: AvailableSlot[] = [];
  for (const s of results) {
    if (picked.length >= opts.maxResults) break;
    const ts = new Date(s.startAt).getTime();
    if (picked.some((p) => Math.abs(new Date(p.startAt).getTime() - ts) < 90 * 60_000)) continue;
    picked.push(s);
  }
  picked.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  return { slots: picked, hasGoogleCalendar: (connections?.length ?? 0) > 0 };
}
