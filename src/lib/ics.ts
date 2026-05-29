// Minimal RFC 5545 ICS generation + parsing.

export type IcsParticipant = {
  email: string;
  name?: string | null;
  role?: "organizer" | "required" | "optional";
};

export type IcsEvent = {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: Date;
  endAt: Date;
  organizer?: { email: string; name?: string | null } | null;
  participants?: IcsParticipant[];
  url?: string | null;
};

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function toIcsDate(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function foldLine(line: string): string {
  // RFC 5545: lines max 75 octets; fold with CRLF + space
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  while (i < line.length) {
    parts.push((i === 0 ? "" : " ") + line.slice(i, i + 73));
    i += 73;
  }
  return parts.join("\r\n");
}

export function buildIcs(event: IcsEvent): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MyHub Pro//Meetings//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(event.startAt)}`,
    `DTEND:${toIcsDate(event.endAt)}`,
    `SUMMARY:${escapeText(event.title)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  if (event.organizer) {
    const cn = event.organizer.name ? `;CN=${escapeText(event.organizer.name)}` : "";
    lines.push(`ORGANIZER${cn}:mailto:${event.organizer.email}`);
  }
  for (const p of event.participants ?? []) {
    const cn = p.name ? `;CN=${escapeText(p.name)}` : "";
    const role = p.role === "optional" ? "OPT-PARTICIPANT" : "REQ-PARTICIPANT";
    lines.push(`ATTENDEE;ROLE=${role};PARTSTAT=NEEDS-ACTION;RSVP=TRUE${cn}:mailto:${p.email}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r\n");
}

export function downloadIcs(event: IcsEvent, filename = "invitation.ics") {
  const blob = new Blob([buildIcs(event)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Parsing ---

function unescapeText(s: string): string {
  return s.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function parseIcsDate(s: string): Date | null {
  // 20260601T140000Z or 20260601T140000 (local) or 20260601 (date)
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", se = "0", z] = m;
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
  return new Date(+y, +mo - 1, +d, +h, +mi, +se);
}

export function parseIcs(text: string): IcsEvent[] {
  // Unfold lines (RFC 5545: lines starting with space/tab continue previous)
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const events: IcsEvent[] = [];
  let current: Partial<IcsEvent> & { participants: IcsParticipant[] } | null = null;

  for (const raw of lines) {
    if (raw === "BEGIN:VEVENT") {
      current = { participants: [] };
      continue;
    }
    if (raw === "END:VEVENT") {
      if (current?.title && current.startAt && current.endAt) {
        events.push({
          uid: current.uid ?? crypto.randomUUID(),
          title: current.title,
          description: current.description ?? null,
          location: current.location ?? null,
          startAt: current.startAt,
          endAt: current.endAt,
          organizer: current.organizer ?? null,
          participants: current.participants,
          url: current.url ?? null,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const colonIdx = raw.indexOf(":");
    if (colonIdx < 0) continue;
    const left = raw.slice(0, colonIdx);
    const value = raw.slice(colonIdx + 1);
    const [name, ...paramParts] = left.split(";");
    const params: Record<string, string> = {};
    for (const p of paramParts) {
      const eq = p.indexOf("=");
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
    }
    switch (name.toUpperCase()) {
      case "UID":
        current.uid = value;
        break;
      case "SUMMARY":
        current.title = unescapeText(value);
        break;
      case "DESCRIPTION":
        current.description = unescapeText(value);
        break;
      case "LOCATION":
        current.location = unescapeText(value);
        break;
      case "URL":
        current.url = value;
        break;
      case "DTSTART":
        current.startAt = parseIcsDate(value) ?? undefined;
        break;
      case "DTEND":
        current.endAt = parseIcsDate(value) ?? undefined;
        break;
      case "ORGANIZER": {
        const email = value.replace(/^mailto:/i, "");
        current.organizer = { email, name: params.CN ?? null };
        break;
      }
      case "ATTENDEE": {
        const email = value.replace(/^mailto:/i, "");
        const role = params.ROLE === "OPT-PARTICIPANT" ? "optional" : "required";
        current.participants.push({ email, name: params.CN ?? null, role });
        break;
      }
    }
  }
  return events;
}

export function extractIcsFromText(text: string): IcsEvent[] {
  if (!text || !text.includes("BEGIN:VCALENDAR")) return [];
  const matches = text.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/g) ?? [];
  return matches.flatMap((m) => parseIcs(m));
}
