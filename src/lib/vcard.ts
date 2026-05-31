// Minimal vCard 2.1 / 3.0 / 4.0 parser sufficient for iCloud, Google and Outlook exports.

export type ParsedContact = {
  first_name: string | null;
  last_name: string | null;
  organization: string | null;
  role: string | null;
  email: string[];
  phone: string[];
  notes: string | null;
};

function unfold(text: string): string[] {
  // Normalize newlines, then unfold lines that begin with space or tab (RFC 6350 §3.2).
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const ln of lines) {
    if ((ln.startsWith(" ") || ln.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += ln.slice(1);
    } else {
      out.push(ln);
    }
  }
  return out;
}

function decodeValue(rawValue: string, params: Record<string, string>): string {
  let v = rawValue;
  const enc = (params.ENCODING ?? "").toUpperCase();
  if (enc === "QUOTED-PRINTABLE") {
    v = v.replace(/=\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
    if ((params.CHARSET ?? "").toUpperCase() === "UTF-8") {
      try {
        v = decodeURIComponent(escape(v));
      } catch {
        /* keep as-is */
      }
    }
  }
  // Unescape vCard escapes
  v = v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
  return v;
}

function splitLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colonIdx = line.indexOf(":");
  if (colonIdx < 0) return null;
  const left = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const parts = left.split(";");
  const name = parts.shift()!.toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq >= 0) {
      params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
    } else {
      // bare param (vCard 2.1), e.g. ";HOME"
      params[p.toUpperCase()] = "true";
    }
  }
  return { name, params, value };
}

export function parseVCard(text: string): ParsedContact[] {
  const lines = unfold(text);
  const contacts: ParsedContact[] = [];
  let current: ParsedContact | null = null;

  for (const raw of lines) {
    if (!raw) continue;
    const parsed = splitLine(raw);
    if (!parsed) continue;
    const { name, params, value } = parsed;

    if (name === "BEGIN" && value.toUpperCase() === "VCARD") {
      current = { first_name: null, last_name: null, organization: null, role: null, email: [], phone: [], notes: null };
      continue;
    }
    if (name === "END" && value.toUpperCase() === "VCARD") {
      if (current) contacts.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const v = decodeValue(value, params);
    // Strip group prefix like "item1.EMAIL"
    const bare = name.includes(".") ? name.split(".").slice(-1)[0] : name;

    switch (bare) {
      case "FN": {
        if (!current.first_name && !current.last_name) {
          const parts = v.trim().split(/\s+/);
          current.first_name = parts.slice(0, -1).join(" ") || parts[0] || null;
          current.last_name = parts.length > 1 ? parts[parts.length - 1] : null;
        }
        break;
      }
      case "N": {
        // N:Family;Given;Additional;Prefix;Suffix
        const [family, given] = v.split(";");
        if (given) current.first_name = given.trim() || current.first_name;
        if (family) current.last_name = family.trim() || current.last_name;
        break;
      }
      case "EMAIL": {
        const e = v.trim();
        if (e && !current.email.includes(e)) current.email.push(e);
        break;
      }
      case "TEL": {
        const p = v.trim();
        if (p && !current.phone.includes(p)) current.phone.push(p);
        break;
      }
      case "ORG": {
        const org = v.split(";")[0].trim();
        if (org) current.organization = org;
        break;
      }
      case "TITLE":
      case "ROLE": {
        const r = v.trim();
        if (r) current.role = r;
        break;
      }
      case "NOTE": {
        const n = v.trim();
        if (n) current.notes = current.notes ? current.notes + "\n" + n : n;
        break;
      }
    }
  }

  return contacts;
}
