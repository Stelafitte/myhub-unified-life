import { supabase } from "@/integrations/supabase/client";
import { differenceInHours, eachDayOfInterval, format, startOfDay, startOfWeek, subDays, subWeeks } from "date-fns";
import { fr } from "date-fns/locale";

export type Period = { from: Date; to: Date };

export type EmailRow = {
  id: string;
  account_id: string;
  from_address: string | null;
  from_name: string | null;
  subject: string | null;
  received_at: string | null;
  is_read: boolean;
  ai_category: string | null;
  ai_priority: string | null;
};

export type TaskRow = {
  id: string;
  status: string;
  priority: string;
  source_app: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
};

export type MeetingRow = {
  id: string;
  start_at: string;
  end_at: string;
  is_online: boolean;
  organizer_email: string | null;
  notes: string | null;
  decisions: string | null;
};

export type AccountRow = { id: string; name: string; type: string; color: string | null };

export type StatsData = {
  emails: EmailRow[];
  tasks: TaskRow[];
  meetings: MeetingRow[];
  accounts: AccountRow[];
  participants: { meeting_id: string; email: string; name: string | null; rsvp_status: string }[];
  meetingTasks: { meeting_id: string }[];
};

export async function fetchStatsData(period: Period): Promise<StatsData> {
  const fromIso = period.from.toISOString();
  const toIso = period.to.toISOString();

  const [e, t, m, a, p, mt] = await Promise.all([
    supabase.from("emails")
      .select("id,account_id,from_address,from_name,subject,received_at,is_read,ai_category,ai_priority")
      .gte("received_at", fromIso).lte("received_at", toIso).limit(5000),
    supabase.from("tasks")
      .select("id,status,priority,source_app,due_date,created_at,updated_at")
      .gte("created_at", fromIso).lte("created_at", toIso).limit(5000),
    supabase.from("meetings")
      .select("id,start_at,end_at,is_online,organizer_email,notes,decisions")
      .gte("start_at", fromIso).lte("start_at", toIso).limit(5000),
    supabase.from("accounts").select("id,name,type,color"),
    supabase.from("meeting_participants").select("meeting_id,email,name,rsvp_status").limit(5000),
    supabase.from("meeting_tasks").select("meeting_id").limit(5000),
  ]);

  return {
    emails: (e.data as EmailRow[]) ?? [],
    tasks: (t.data as TaskRow[]) ?? [],
    meetings: (m.data as MeetingRow[]) ?? [],
    accounts: (a.data as AccountRow[]) ?? [],
    participants: (p.data as StatsData["participants"]) ?? [],
    meetingTasks: (mt.data as { meeting_id: string }[]) ?? [],
  };
}

// ===== EMAIL METRICS =====

export function emailsPerDayByAccount(emails: EmailRow[], accounts: AccountRow[], period: Period) {
  const days = eachDayOfInterval({ start: period.from, end: period.to });
  return days.map((d) => {
    const key = format(d, "dd/MM");
    const row: Record<string, string | number> = { date: key };
    for (const a of accounts) row[a.name] = 0;
    for (const e of emails) {
      if (!e.received_at) continue;
      if (format(new Date(e.received_at), "dd/MM") !== key) continue;
      const acc = accounts.find((a) => a.id === e.account_id);
      if (acc) row[acc.name] = (Number(row[acc.name]) || 0) + 1;
    }
    return row;
  });
}

export function emailsBySource(emails: EmailRow[], accounts: AccountRow[]) {
  const m = new Map<string, number>();
  for (const e of emails) {
    const acc = accounts.find((a) => a.id === e.account_id);
    const k = acc?.type ?? "autre";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m, ([name, value]) => ({ name, value }));
}

export function readRate(emails: EmailRow[]): number {
  if (emails.length === 0) return 0;
  return Math.round((emails.filter((e) => e.is_read).length / emails.length) * 100);
}

export function avgTimeToRead(emails: EmailRow[]): number {
  // Approximation: when read but no read_at, assume diff between received and now (capped)
  // Using updated_at proxy isn't available — we just count read emails received older than 24h.
  const read = emails.filter((e) => e.is_read && e.received_at);
  if (read.length === 0) return 0;
  const now = Date.now();
  const hours = read.map((e) => Math.min(72, Math.max(0, differenceInHours(now, new Date(e.received_at!)))));
  return Math.round(hours.reduce((a, b) => a + b, 0) / hours.length);
}

export function topSenders(emails: EmailRow[], limit = 10) {
  const m = new Map<string, { name: string; count: number }>();
  for (const e of emails) {
    if (!e.from_address) continue;
    const k = e.from_address.toLowerCase();
    const cur = m.get(k) ?? { name: e.from_name ?? e.from_address, count: 0 };
    cur.count++;
    m.set(k, cur);
  }
  return Array.from(m, ([email, v]) => ({ email, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count).slice(0, limit);
}

export function receptionHeatmap(emails: EmailRow[]) {
  // 7 days × 24 hours
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const e of emails) {
    if (!e.received_at) continue;
    const d = new Date(e.received_at);
    grid[d.getDay()][d.getHours()]++;
  }
  return grid;
}

export function actionVsInfo(emails: EmailRow[]) {
  let action = 0, info = 0;
  for (const e of emails) {
    if (e.ai_category === "action" || e.ai_category === "rendez-vous" || e.ai_category === "facturation") action++;
    else info++;
  }
  return [{ name: "Avec action", value: action }, { name: "Informatif", value: info }];
}

// ===== TASK METRICS =====

export function tasksCreatedVsDoneByWeek(tasks: TaskRow[], period: Period) {
  const weeks: { week: string; start: Date }[] = [];
  let cur = startOfWeek(period.from, { weekStartsOn: 1 });
  while (cur <= period.to) {
    weeks.push({ week: format(cur, "dd MMM", { locale: fr }), start: new Date(cur) });
    cur = new Date(cur.getTime() + 7 * 24 * 3600 * 1000);
  }
  return weeks.map((w, i) => {
    const end = weeks[i + 1]?.start ?? new Date(period.to.getTime() + 1);
    let created = 0, done = 0;
    for (const t of tasks) {
      const c = new Date(t.created_at);
      if (c >= w.start && c < end) created++;
      if (t.status === "done") {
        const u = new Date(t.updated_at);
        if (u >= w.start && u < end) done++;
      }
    }
    return { week: w.week, créées: created, terminées: done };
  });
}

export function completionRate(tasks: TaskRow[]): number {
  if (tasks.length === 0) return 0;
  return Math.round((tasks.filter((t) => t.status === "done").length / tasks.length) * 100);
}

export function tasksByPriority(tasks: TaskRow[]) {
  const m = new Map<string, number>();
  for (const t of tasks) m.set(t.priority, (m.get(t.priority) ?? 0) + 1);
  return Array.from(m, ([name, value]) => ({ name, value }));
}

export function tasksBySource(tasks: TaskRow[]) {
  const m = new Map<string, number>();
  for (const t of tasks) m.set(t.source_app, (m.get(t.source_app) ?? 0) + 1);
  return Array.from(m, ([name, value]) => ({ name, value }));
}

export function avgCompletionDays(tasks: TaskRow[]): number {
  const done = tasks.filter((t) => t.status === "done");
  if (done.length === 0) return 0;
  const days = done.map((t) => Math.max(0, (new Date(t.updated_at).getTime() - new Date(t.created_at).getTime()) / 86400000));
  return Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10;
}

export function overdueTasks(tasks: TaskRow[]): number {
  const now = Date.now();
  return tasks.filter((t) => t.status !== "done" && t.due_date && new Date(t.due_date).getTime() < now).length;
}

export function activityHeatmap(tasks: TaskRow[], period: Period) {
  const days = eachDayOfInterval({ start: period.from, end: period.to });
  return days.map((d) => {
    const key = startOfDay(d).getTime();
    const count = tasks.filter((t) => t.status === "done" && startOfDay(new Date(t.updated_at)).getTime() === key).length;
    return { date: d, count };
  });
}

// ===== MEETING METRICS =====

export function meetingsPerWeek(meetings: MeetingRow[], period: Period) {
  const weeks: { week: string; start: Date }[] = [];
  let cur = startOfWeek(period.from, { weekStartsOn: 1 });
  while (cur <= period.to) {
    weeks.push({ week: format(cur, "dd MMM", { locale: fr }), start: new Date(cur) });
    cur = new Date(cur.getTime() + 7 * 24 * 3600 * 1000);
  }
  return weeks.map((w, i) => {
    const end = weeks[i + 1]?.start ?? new Date(period.to.getTime() + 1);
    const count = meetings.filter((m) => {
      const s = new Date(m.start_at);
      return s >= w.start && s < end;
    }).length;
    return { week: w.week, réunions: count };
  });
}

export function totalMeetingHours(meetings: MeetingRow[]): number {
  const h = meetings.reduce((acc, m) => acc + (new Date(m.end_at).getTime() - new Date(m.start_at).getTime()) / 3600000, 0);
  return Math.round(h * 10) / 10;
}

export function rsvpAcceptanceRate(participants: StatsData["participants"], userEmail: string | null): number {
  if (!userEmail) return 0;
  const mine = participants.filter((p) => p.email.toLowerCase() === userEmail.toLowerCase());
  if (mine.length === 0) return 0;
  return Math.round((mine.filter((p) => p.rsvp_status === "accepted").length / mine.length) * 100);
}

export function onlineVsOnsite(meetings: MeetingRow[]) {
  const online = meetings.filter((m) => m.is_online).length;
  const onsite = meetings.length - online;
  return [{ name: "Visio", value: online }, { name: "Présentiel", value: onsite }];
}

export function avgTasksPerMeeting(meetings: MeetingRow[], meetingTasks: { meeting_id: string }[]): number {
  if (meetings.length === 0) return 0;
  const counts = meetings.map((m) => meetingTasks.filter((mt) => mt.meeting_id === m.id).length);
  return Math.round((counts.reduce((a, b) => a + b, 0) / meetings.length) * 10) / 10;
}

export function topParticipants(participants: StatsData["participants"], userEmail: string | null, limit = 10) {
  const m = new Map<string, { name: string; count: number }>();
  for (const p of participants) {
    if (userEmail && p.email.toLowerCase() === userEmail.toLowerCase()) continue;
    const k = p.email.toLowerCase();
    const cur = m.get(k) ?? { name: p.name ?? p.email, count: 0 };
    cur.count++;
    m.set(k, cur);
  }
  return Array.from(m, ([email, v]) => ({ email, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count).slice(0, limit);
}

// ===== PRODUCTIVITY SCORE =====

export function productivityScore(data: StatsData): number {
  const read = readRate(data.emails);
  const complete = completionRate(data.tasks);
  const onTime = data.tasks.length === 0 ? 100 : Math.round(
    (data.tasks.filter((t) => {
      if (t.status !== "done" || !t.due_date) return true;
      return new Date(t.updated_at) <= new Date(t.due_date);
    }).length / data.tasks.length) * 100,
  );
  const withCr = data.meetings.length === 0 ? 100 : Math.round(
    (data.meetings.filter((m) => (m.notes && m.notes.trim()) || (m.decisions && m.decisions.trim())).length / data.meetings.length) * 100,
  );
  return Math.round(read * 0.25 + complete * 0.35 + onTime * 0.25 + withCr * 0.15);
}

export async function previousScore(period: Period): Promise<number> {
  const span = period.to.getTime() - period.from.getTime();
  const prev: Period = { from: new Date(period.from.getTime() - span), to: new Date(period.from.getTime() - 1) };
  const d = await fetchStatsData(prev);
  return productivityScore(d);
}

// ===== INSIGHTS =====

export function generateInsights(data: StatsData, prevData: StatsData | null): string[] {
  const insights: string[] = [];
  if (prevData) {
    const diff = data.emails.length - prevData.emails.length;
    if (Math.abs(diff) > 5) {
      insights.push(`Cette semaine vous avez ${diff > 0 ? "reçu" : "traité"} ${Math.abs(diff)} email${Math.abs(diff) > 1 ? "s" : ""} ${diff > 0 ? "de plus" : "de moins"} qu'à la période précédente.`);
    }
  }
  const heat = receptionHeatmap(data.emails);
  let peak = { d: 0, h: 0, v: 0 };
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) if (heat[d][h] > peak.v) peak = { d, h, v: heat[d][h] };
  if (peak.v > 0) {
    const dayNames = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];
    insights.push(`Votre pic d'activité est le ${dayNames[peak.d]} vers ${peak.h}h.`);
  }
  // Recurring tasks: titles repeated? Not available here, count overdue.
  const overdue = overdueTasks(data.tasks);
  if (overdue > 0) insights.push(`Vous avez ${overdue} tâche${overdue > 1 ? "s" : ""} en retard — pensez à les replanifier.`);
  const rate = completionRate(data.tasks);
  if (rate >= 80 && data.tasks.length >= 5) insights.push(`Taux de complétion excellent (${rate}%) — continuez sur cette lancée !`);
  return insights.slice(0, 4);
}

// ===== PRESETS =====

export function presetPeriod(kind: "7d" | "30d" | "90d" | "year"): Period {
  const to = new Date();
  switch (kind) {
    case "7d": return { from: subDays(to, 7), to };
    case "30d": return { from: subDays(to, 30), to };
    case "90d": return { from: subDays(to, 90), to };
    case "year": return { from: new Date(to.getFullYear(), 0, 1), to };
  }
}
