import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  BarChart3, Mail, CheckSquare, CalendarClock, TrendingUp, TrendingDown,
  Sparkles, Loader2, Calendar as CalIcon,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  type Period, type StatsData, fetchStatsData, presetPeriod,
  emailsPerDayByAccount, emailsBySource, readRate, avgTimeToRead, topSenders,
  receptionHeatmap, actionVsInfo,
  tasksCreatedVsDoneByWeek, completionRate, tasksByPriority, tasksBySource,
  avgCompletionDays, overdueTasks, activityHeatmap,
  meetingsPerWeek, totalMeetingHours, rsvpAcceptanceRate, onlineVsOnsite,
  avgTasksPerMeeting, topParticipants,
  productivityScore, previousScore, generateInsights,
} from "@/lib/stats";

export const Route = createFileRoute("/_authenticated/stats")({
  component: StatsPage,
});

const COLORS = ["hsl(var(--primary))", "#10b981", "#f59e0b", "#ef4444", "#6366f1", "#ec4899", "#06b6d4", "#84cc16"];

type PresetKey = "7d" | "30d" | "90d" | "year" | "custom";

function StatsPage() {
  const [preset, setPreset] = useState<PresetKey>("30d");
  const [customFrom, setCustomFrom] = useState(format(presetPeriod("30d").from, "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [data, setData] = useState<StatsData | null>(null);
  const [prevData, setPrevData] = useState<StatsData | null>(null);
  const [score, setScore] = useState(0);
  const [prevScoreVal, setPrevScoreVal] = useState(0);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const period: Period = useMemo(() => {
    if (preset === "custom") return { from: new Date(customFrom), to: new Date(customTo + "T23:59:59") };
    return presetPeriod(preset);
  }, [preset, customFrom, customTo]);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      setUserEmail(u.user?.email ?? null);
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const d = await fetchStatsData(period);
      const span = period.to.getTime() - period.from.getTime();
      const prevP: Period = { from: new Date(period.from.getTime() - span), to: new Date(period.from.getTime() - 1) };
      const pd = await fetchStatsData(prevP);
      if (cancelled) return;
      setData(d);
      setPrevData(pd);
      setScore(productivityScore(d));
      setPrevScoreVal(productivityScore(pd));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [period.from.getTime(), period.to.getTime()]);

  return (
    <div className="flex flex-col h-full">
      <header className="border-b bg-background px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h1 className="font-semibold">Statistiques & rapports</h1>
        </div>
        <div className="flex items-center gap-1.5">
          {(["7d","30d","90d","year"] as const).map((k) => (
            <Button key={k} size="sm" variant={preset === k ? "default" : "outline"} onClick={() => setPreset(k)}>
              {k === "7d" ? "7 j" : k === "30d" ? "30 j" : k === "90d" ? "90 j" : "Année"}
            </Button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant={preset === "custom" ? "default" : "outline"}>
                <CalIcon className="mr-1 h-3.5 w-3.5" /> Personnalisé
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-2">
              <div>
                <label className="text-xs text-muted-foreground">Du</label>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Au</label>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
              <Button size="sm" className="w-full" onClick={() => setPreset("custom")}>Appliquer</Button>
            </PopoverContent>
          </Popover>
        </div>
      </header>

      {loading || !data ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Calcul des statistiques…
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <ProductivityCard score={score} prev={prevScoreVal} insights={generateInsights(data, prevData)} />

          <Tabs defaultValue="emails" className="space-y-4">
            <TabsList>
              <TabsTrigger value="emails"><Mail className="mr-1.5 h-3.5 w-3.5" />Emails</TabsTrigger>
              <TabsTrigger value="tasks"><CheckSquare className="mr-1.5 h-3.5 w-3.5" />Tâches</TabsTrigger>
              <TabsTrigger value="meetings"><CalendarClock className="mr-1.5 h-3.5 w-3.5" />Réunions</TabsTrigger>
            </TabsList>

            <TabsContent value="emails" className="space-y-4">
              <EmailsSection data={data} period={period} />
            </TabsContent>
            <TabsContent value="tasks" className="space-y-4">
              <TasksSection data={data} period={period} />
            </TabsContent>
            <TabsContent value="meetings" className="space-y-4">
              <MeetingsSection data={data} userEmail={userEmail} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, suffix }: { label: string; value: number | string; suffix?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold mt-1">{value}{suffix && <span className="text-base font-normal text-muted-foreground ml-1">{suffix}</span>}</div>
      </CardContent>
    </Card>
  );
}

function ProductivityCard({ score, prev, insights }: { score: number; prev: number; insights: string[] }) {
  const diff = prev > 0 ? Math.round(((score - prev) / prev) * 100) : 0;
  const up = diff >= 0;
  return (
    <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
      <CardContent className="p-5 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-5 items-center">
        <div className="flex flex-col items-center justify-center">
          <div className="relative h-28 w-28">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/40" />
              <circle
                cx="50" cy="50" r="42" fill="none"
                stroke="currentColor" strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${(score / 100) * 263.9} 263.9`}
                className="text-primary"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold">{score}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">/ 100</span>
            </div>
          </div>
          <div className="mt-2 text-xs font-medium text-muted-foreground">Score de productivité</div>
          {prev > 0 && (
            <Badge variant={up ? "default" : "destructive"} className="mt-1 gap-1">
              {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {up ? "+" : ""}{diff}% vs précédente
            </Badge>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-primary" /> Insights de la période
          </div>
          {insights.length === 0 ? (
            <p className="text-sm text-muted-foreground">Pas assez de données pour générer des insights.</p>
          ) : (
            <ul className="space-y-1.5">
              {insights.map((i, idx) => (
                <li key={idx} className="text-sm flex gap-2"><span className="text-primary">•</span>{i}</li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function EmailsSection({ data, period }: { data: StatsData; period: Period }) {
  const perDay = emailsPerDayByAccount(data.emails, data.accounts, period);
  const sources = emailsBySource(data.emails, data.accounts);
  const rRate = readRate(data.emails);
  const avgRead = avgTimeToRead(data.emails);
  const senders = topSenders(data.emails);
  const heat = receptionHeatmap(data.emails);
  const ai = actionVsInfo(data.emails);
  const dayNames = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
  const maxHeat = Math.max(1, ...heat.flat());

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Emails reçus" value={data.emails.length} />
        <Kpi label="Taux de lecture" value={rRate} suffix="%" />
        <Kpi label="Délai moy. lecture" value={avgRead} suffix="h" />
        <Kpi label="Expéditeurs uniques" value={new Set(data.emails.map((e) => e.from_address)).size} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Volume par jour et par compte</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={perDay}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip />
              <Legend />
              {data.accounts.map((a, i) => (
                <Line key={a.id} type="monotone" dataKey={a.name} stroke={a.color ?? COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Répartition par source</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={sources} dataKey="value" nameKey="name" outerRadius={80} label>
                  {sources.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Action vs informatif</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={ai} dataKey="value" nameKey="name" outerRadius={80} label>
                  {ai.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Heatmap des réceptions (heure × jour)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="inline-flex flex-col gap-0.5 text-[10px]">
              <div className="flex gap-0.5 pl-6">
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="w-4 text-center text-muted-foreground">{h % 3 === 0 ? h : ""}</div>
                ))}
              </div>
              {heat.map((row, d) => (
                <div key={d} className="flex gap-0.5 items-center">
                  <div className="w-6 text-muted-foreground">{dayNames[d]}</div>
                  {row.map((v, h) => (
                    <div
                      key={h}
                      title={`${dayNames[d]} ${h}h : ${v}`}
                      className="w-4 h-4 rounded-sm"
                      style={{ backgroundColor: v === 0 ? "hsl(var(--muted))" : `hsl(var(--primary) / ${0.15 + (v / maxHeat) * 0.85})` }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Top 10 expéditeurs</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {senders.map((s) => (
              <div key={s.email} className="flex items-center gap-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{s.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{s.email}</div>
                </div>
                <Badge variant="secondary">{s.count}</Badge>
              </div>
            ))}
            {senders.length === 0 && <p className="text-sm text-muted-foreground">Aucun email sur la période.</p>}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function TasksSection({ data, period }: { data: StatsData; period: Period }) {
  const weekly = tasksCreatedVsDoneByWeek(data.tasks, period);
  const cRate = completionRate(data.tasks);
  const prio = tasksByPriority(data.tasks);
  const src = tasksBySource(data.tasks);
  const avgDays = avgCompletionDays(data.tasks);
  const over = overdueTasks(data.tasks);
  const heat = activityHeatmap(data.tasks, period);
  const maxAct = Math.max(1, ...heat.map((h) => h.count));

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Tâches" value={data.tasks.length} />
        <Kpi label="Complétion" value={cRate} suffix="%" />
        <Kpi label="Délai moyen" value={avgDays} suffix="j" />
        <Kpi label="En retard" value={over} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Créées vs terminées par semaine</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={weekly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip />
              <Legend />
              <Bar dataKey="créées" fill={COLORS[4]} />
              <Bar dataKey="terminées" fill={COLORS[1]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Par priorité</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={prio} dataKey="value" nameKey="name" outerRadius={80} label>
                  {prio.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Par source</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={src} dataKey="value" nameKey="name" outerRadius={80} label>
                  {src.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Activité quotidienne (tâches terminées)</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-0.5">
            {heat.map((h, i) => (
              <div
                key={i}
                title={`${format(h.date, "dd MMM yyyy", { locale: fr })} : ${h.count}`}
                className="w-3.5 h-3.5 rounded-sm"
                style={{ backgroundColor: h.count === 0 ? "hsl(var(--muted))" : `hsl(var(--primary) / ${0.2 + (h.count / maxAct) * 0.8})` }}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function MeetingsSection({ data, userEmail }: { data: StatsData; userEmail: string | null }) {
  const period: Period = { from: new Date(Math.min(...data.meetings.map((m) => new Date(m.start_at).getTime()), Date.now())), to: new Date() };
  const weekly = meetingsPerWeek(data.meetings, period);
  const hours = totalMeetingHours(data.meetings);
  const accept = rsvpAcceptanceRate(data.participants, userEmail);
  const modes = onlineVsOnsite(data.meetings);
  const avgT = avgTasksPerMeeting(data.meetings, data.meetingTasks);
  const top = topParticipants(data.participants, userEmail);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Réunions" value={data.meetings.length} />
        <Kpi label="Heures totales" value={hours} suffix="h" />
        <Kpi label="Acceptation" value={accept} suffix="%" />
        <Kpi label="Tâches / réunion" value={avgT} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Réunions par semaine</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weekly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip />
                <Bar dataKey="réunions" fill={COLORS[0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Visio vs présentiel</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={modes} dataKey="value" nameKey="name" outerRadius={80} label>
                  {modes.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Top participants</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {top.map((p) => (
              <div key={p.email} className="flex items-center gap-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{p.email}</div>
                </div>
                <Badge variant="secondary">{p.count}</Badge>
              </div>
            ))}
            {top.length === 0 && <p className="text-sm text-muted-foreground">Aucun participant sur la période.</p>}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
