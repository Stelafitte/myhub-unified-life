import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Types ----------
interface ParsedMessage {
  message_at: string; // ISO
  sender: string;
  content: string;
  is_system: boolean;
}

interface AiDetection {
  index: number;
  action?: { found: boolean; description?: string; priority?: "urgent" | "normal" | "low" };
  meeting?: { found: boolean; title?: string; date?: string };
  document?: { found: boolean; name?: string };
  decision?: { found: boolean; description?: string };
}

// ---------- Regex ----------
// Supports both "15/03/2024 à 09:32 - X: msg" and "[15/03/2024 09:32:11] X: msg"
const MESSAGE_REGEX_FR =
  /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(?:à|[,]?)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[-–]\s*([^:]+?):\s*(.*)$/;
const SYSTEM_HINTS = [
  "a ajouté",
  "a quitté",
  "a été ajouté",
  "a été retiré",
  "a changé",
  "a créé le groupe",
  "Les messages et les appels sont chiffrés",
];

function parseDate(d: string, m: string, y: string, hh: string, mm: string, ss?: string): string {
  const year = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
  // Stored as local midnight Paris-ish — keep simple ISO in UTC equivalent
  const date = new Date(Date.UTC(year, parseInt(m, 10) - 1, parseInt(d, 10), parseInt(hh, 10), parseInt(mm, 10), ss ? parseInt(ss, 10) : 0));
  return date.toISOString();
}

function parseWhatsAppExport(content: string): ParsedMessage[] {
  // Strip invisible LRM/RLM characters WhatsApp adds
  const cleaned = content.replace(/[\u200E\u200F\u202A-\u202E]/g, "");
  const lines = cleaned.split(/\r?\n/);
  const out: ParsedMessage[] = [];
  let current: ParsedMessage | null = null;

  for (const line of lines) {
    const m = line.match(MESSAGE_REGEX_FR);
    if (m) {
      if (current) out.push(current);
      const [, d, mo, y, hh, mm, ss, senderRaw, contentRaw] = m;
      const sender = senderRaw.trim();
      const text = contentRaw.trim();
      const isSystem =
        sender.toLowerCase() === "null" ||
        SYSTEM_HINTS.some((h) => text.includes(h));
      current = {
        message_at: parseDate(d, mo, y, hh, mm, ss),
        sender,
        content: text,
        is_system: isSystem,
      };
    } else if (current && line.trim().length > 0) {
      current.content += "\n" + line;
    }
  }
  if (current) out.push(current);
  return out;
}

// ---------- AI batch ----------
async function analyzeBatch(messages: ParsedMessage[], apiKey: string): Promise<AiDetection[]> {
  const numbered = messages.map((m, i) => ({
    i,
    at: m.message_at,
    from: m.sender,
    text: m.content.slice(0, 500),
  }));

  const systemPrompt = `Tu analyses des messages WhatsApp d'un groupe médical/professionnel français.
Pour chaque message, détecte :
- ACTION à faire (oui/non + description + priorité urgent|normal|low)
- RÉUNION mentionnée (oui/non + titre + date ISO si déductible)
- DOCUMENT mentionné (oui/non + nom)
- DÉCISION prise (oui/non + description)

Réponds STRICTEMENT en JSON avec la forme:
{ "detections": [ { "index": <int>, "action": {...}, "meeting": {...}, "document": {...}, "decision": {...} } ] }
Inclus uniquement les messages avec au moins une détection positive.`;

  const userPrompt = `Messages:\n${JSON.stringify(numbered)}`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "raw-fetch",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      console.error("AI gateway error", res.status, await res.text().catch(() => ""));
      return [];
    }
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.detections) ? parsed.detections : [];
  } catch (e) {
    console.error("AI batch failed", e);
    return [];
  }
}

// ---------- Server function ----------
const InputSchema = z.object({
  space_id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  content_b64: z.string().min(1),
});

export const importWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify space ownership
    const { data: space, error: spaceErr } = await supabase
      .from("collab_spaces")
      .select("id, name, user_id")
      .eq("id", data.space_id)
      .maybeSingle();
    if (spaceErr || !space) throw new Error("Espace introuvable");
    if (space.user_id !== userId) throw new Error("Accès refusé");

    // Decode content
    let textContent = "";
    try {
      textContent = atob(data.content_b64);
      // atob produces binary string; decode as UTF-8
      const bytes = new Uint8Array(textContent.length);
      for (let i = 0; i < textContent.length; i++) bytes[i] = textContent.charCodeAt(i);
      textContent = new TextDecoder("utf-8").decode(bytes);
    } catch {
      throw new Error("Contenu base64 invalide");
    }

    // Create import row
    const { data: importRow, error: importErr } = await supabase
      .from("collab_wa_imports")
      .insert({
        space_id: data.space_id,
        user_id: userId,
        filename: data.filename,
        raw_content: textContent.slice(0, 200_000),
        status: "processing",
        total_messages: 0,
      })
      .select("id")
      .single();
    if (importErr || !importRow) throw new Error("Impossible de créer l'import");
    const importId = importRow.id;

    const updateImport = async (patch: Record<string, unknown>) => {
      await supabase.from("collab_wa_imports").update(patch).eq("id", importId);
    };

    try {
      // Parse
      const parsed = parseWhatsAppExport(textContent);
      const total = parsed.length;
      await updateImport({ total_messages: total });

      if (total === 0) {
        await updateImport({ status: "done", imported_messages: 0 });
        return {
          ok: true,
          total_messages: 0,
          imported: 0,
          duplicates: 0,
          actions_created: 0,
          meetings_detected: 0,
          decisions_found: 0,
        };
      }

      // Bulk insert messages with dedup
      const rows = parsed.map((p) => ({
        space_id: data.space_id,
        user_id: userId,
        content: p.content,
        type: p.is_system ? "system" : "text",
        sender_name: p.sender,
        message_at: p.message_at,
        metadata: { is_imported: true, sender_name: p.sender },
      }));

      let inserted = 0;
      let duplicates = 0;
      // Insert in chunks of 500 with onConflict ignore via upsert
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { data: insRes, error: insErr } = await supabase
          .from("collab_messages")
          .upsert(chunk, {
            onConflict: "space_id,message_at,sender_name",
            ignoreDuplicates: true,
          })
          .select("id");
        if (insErr) {
          console.error("Insert messages chunk error", insErr);
        } else {
          inserted += insRes?.length ?? 0;
        }
        await updateImport({ imported_messages: inserted });
      }
      duplicates = total - inserted;

      // ---------- AI analysis (batch of 20, non-system messages only) ----------
      const apiKey = process.env.LOVABLE_API_KEY;
      let actionsCreated = 0;
      let meetingsDetected = 0;
      let decisionsFound = 0;

      if (apiKey) {
        const analysable = parsed.filter((p) => !p.is_system && p.content.length > 5);
        for (let i = 0; i < analysable.length; i += 20) {
          const batch = analysable.slice(i, i + 20);
          const detections = await analyzeBatch(batch, apiKey);

          for (const det of detections) {
            const src = batch[det.index];
            if (!src) continue;
            const ctxNote = `Issu de WhatsApp (${src.sender}, ${new Date(src.message_at).toLocaleString("fr-FR")}): « ${src.content.slice(0, 200)} »`;

            // ACTION → task proposition
            if (det.action?.found && det.action.description) {
              const pri =
                det.action.priority === "urgent"
                  ? "urgent"
                  : det.action.priority === "low"
                    ? "low"
                    : "medium";
              const { error: tErr } = await supabase.from("tasks").insert({
                user_id: userId,
                title: det.action.description.slice(0, 200),
                description: ctxNote,
                status: "todo",
                priority: pri,
                source_app: "whatsapp",
                tags: ["proposition-whatsapp", `espace:${space.name}`],
              });
              if (!tErr) actionsCreated++;
            }

            // MEETING → calendar event proposition
            if (det.meeting?.found && det.meeting.title) {
              const start = det.meeting.date ? new Date(det.meeting.date) : null;
              if (start && !isNaN(start.getTime())) {
                const end = new Date(start.getTime() + 60 * 60 * 1000);
                const { error: cErr } = await supabase.from("calendar_events").insert({
                  user_id: userId,
                  title: `[Proposition WA] ${det.meeting.title.slice(0, 200)}`,
                  description: ctxNote,
                  start_at: start.toISOString(),
                  end_at: end.toISOString(),
                  category: "pro",
                });
                if (!cErr) meetingsDetected++;
              }
            }

            // DECISION → log as collab_messages of type 'decision'
            if (det.decision?.found && det.decision.description) {
              await supabase.from("collab_messages").insert({
                space_id: data.space_id,
                user_id: userId,
                content: det.decision.description.slice(0, 1000),
                type: "decision",
                sender_name: src.sender,
                message_at: src.message_at,
                metadata: {
                  is_imported: true,
                  source_text: src.content.slice(0, 500),
                  badge: "Décision",
                },
              });
              decisionsFound++;
            }
          }
        }
      } else {
        console.warn("LOVABLE_API_KEY missing — skipping AI analysis");
      }

      await updateImport({ status: "done", imported_messages: inserted });

      return {
        ok: true,
        total_messages: total,
        imported: inserted,
        duplicates,
        actions_created: actionsCreated,
        meetings_detected: meetingsDetected,
        decisions_found: decisionsFound,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await updateImport({ status: "failed", error_message: msg.slice(0, 500) });
      throw e;
    }
  });
