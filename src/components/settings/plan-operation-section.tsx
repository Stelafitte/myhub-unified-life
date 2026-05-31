import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  ClipboardList,
  Sparkles,
  ArrowUp,
  ArrowDown,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Theme = {
  id: string;
  user_id: string;
  name: string;
  position: number;
};

type Subtheme = {
  id: string;
  user_id: string;
  theme_id: string;
  name: string;
  position: number;
  items: string[];
};

// Modèle inspiré du fichier Excel "Plan opérationnel"
const TEMPLATE: { theme: string; subthemes: { name: string; items: string[] }[] }[] = [
  {
    theme: "CHEFFERIE DE SERVICE",
    subthemes: [
      { name: "Projet de service", items: [] },
      { name: "Réunion de service", items: [] },
      { name: "Réunion universitaire + CR", items: [] },
      { name: "RDV DAM", items: [] },
      { name: "Révision des effectifs", items: [] },
      { name: "Post internat", items: [] },
    ],
  },
  {
    theme: "BUREAU SFC",
    subthemes: [
      { name: "Commission formation", items: [] },
      { name: "Prix et bourses SFC", items: [] },
      { name: "FIC", items: [] },
      { name: "Bureau", items: [] },
      { name: "CA", items: [] },
      { name: "J groupes et filiales", items: [] },
      { name: "Stratégie opérationnelle", items: [] },
      { name: "Budget", items: ["Budget prévisionnel", "Budget à finaliser"] },
      { name: "Charte de fonctionnement", items: [] },
      { name: "Sessions JESFC", items: [] },
    ],
  },
  {
    theme: "AUDIT SFC",
    subthemes: [
      {
        name: "Audit",
        items: [
          "Recherche documentaire",
          "Consolidation des données",
          "Analyse des données",
          "Gouvernance",
          "Budget",
          "Process",
          "Livraison audit",
        ],
      },
    ],
  },
  {
    theme: "COMMUNICATION",
    subthemes: [
      { name: "EchoWebline", items: [] },
      { name: "Réseau social", items: [] },
      { name: "Communication site internet", items: [] },
      { name: "Charte sites internet", items: [] },
    ],
  },
  {
    theme: "ÉVÉNEMENTS / CONGRÈS",
    subthemes: [
      { name: "Atelier simulateur écho Bordeaux", items: [] },
      { name: "Paris Echo 2025", items: [] },
      { name: "Medisim", items: [] },
      { name: "JESFC", items: ["RAO femme", "Essentiel imagerie", "IM primitive", "Remerciements"] },
      { name: "Village simu", items: [] },
      { name: "Au tours des valves", items: ["Programme"] },
    ],
  },
  {
    theme: "PRODUCTIONS",
    subthemes: [
      { name: "ACVD pratique", items: ["Sommaire"] },
      { name: "Cardiopratique", items: [] },
      { name: "Revue du praticien", items: [] },
      { name: "CNCF — RAO asympto", items: [] },
      { name: "Cours DIU écho CMI", items: [] },
      { name: "Cardiovalves", items: ["RAO modéré et dysfn VG", "CT quantifier IT", "Philips", "Intrepid", "Modération 2026"] },
      { name: "Cordiam — Images du mois", items: [] },
      { name: "Septimus", items: [] },
      { name: "Atelier Medtronic", items: [] },
      { name: "Lettre du cardiologue — RAO H/F", items: [] },
      { name: "Traité imagerie cardiovasculaire", items: [] },
      { name: "Livre SFC — coord chapitres", items: ["Sollicitations auteurs"] },
    ],
  },
  {
    theme: "ENSEIGNEMENT",
    subthemes: [
      { name: "Cours DIU interventionnel", items: [] },
      { name: "Cours manip radio IFMEM", items: [] },
      { name: "Rapport thèse", items: [] },
      { name: "Rapport HDR", items: [] },
      { name: "Cours MM1", items: ["RAO", "EI", "IM", "iEDN"] },
      { name: "Cours L2 — Sémio card", items: ["QCM L2 semio card"] },
      { name: "QCM IPA", items: [] },
      { name: "Examens MM1", items: ["1 DP et 3 QCM par cours"] },
    ],
  },
  {
    theme: "RECHERCHE",
    subthemes: [
      { name: "PRIME-MR", items: [] },
      { name: "Atomic", items: [] },
      { name: "Article AI Stéphane", items: [] },
      { name: "Thèse SAMI ATOMIC", items: [] },
      { name: "EHJ Letter M TEER", items: [] },
      { name: "Endophtalmitis", items: [] },
      { name: "Pharmheart", items: [] },
      { name: "Comité adjudication MITRA HR", items: [] },
      { name: "Master SIFA Jordan", items: [] },
      { name: "Mémoire Antonin CMH", items: [] },
      { name: "Mitragister", items: [] },
      { name: "Redo Mitraclip", items: [] },
    ],
  },
  {
    theme: "REVIEWS",
    subthemes: [
      { name: "EJPC", items: [] },
      { name: "EHJCVI", items: [] },
      { name: "EACVI — review process book", items: [] },
    ],
  },
  {
    theme: "COMITÉS SCIENTIFIQUES",
    subthemes: [
      { name: "Fondation Cœur et Recherche", items: ["Réunion de bureau", "Audit de dossiers"] },
      { name: "Sociétés européennes", items: [] },
      { name: "EACVI", items: [] },
      { name: "Grading abstracts ESC", items: [] },
      { name: "Grading abstracts EuroEcho", items: [] },
      { name: "Multivalve France", items: [] },
      { name: "Prix Lucie et Olga Fradiss", items: [] },
      { name: "Centre de compétences", items: [] },
    ],
  },
  {
    theme: "EXPERTISES",
    subthemes: [
      { name: "Mediator", items: [] },
      { name: "Enseignement examen", items: [] },
      { name: "IPA", items: [] },
    ],
  },
];

export function PlanOperationSection() {
  const { user } = useAuth();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [subthemes, setSubthemes] = useState<Subtheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [newTheme, setNewTheme] = useState("");
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [editingThemeName, setEditingThemeName] = useState("");
  const [newSubtheme, setNewSubtheme] = useState<Record<string, string>>({});
  const [editingSub, setEditingSub] = useState<string | null>(null);
  const [editingSubName, setEditingSubName] = useState("");
  const [newItem, setNewItem] = useState<Record<string, string>>({});
  // Selection: keys are "theme:<id>" | "sub:<id>" | "item:<subId>:<index>"
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSel = (key: string) =>
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  const isSel = (key: string) => selected.has(key);

  const load = async () => {
    setLoading(true);
    const [t, s] = await Promise.all([
      supabase.from("op_plan_themes").select("*").order("position"),
      supabase.from("op_plan_subthemes").select("*").order("position"),
    ]);
    if (t.error) toast.error(t.error.message);
    if (s.error) toast.error(s.error.message);
    setThemes((t.data ?? []) as Theme[]);
    setSubthemes((s.data ?? []) as Subtheme[]);
    setLoading(false);
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  const grouped = useMemo(() => {
    return themes.map((t) => ({
      theme: t,
      subs: subthemes.filter((s) => s.theme_id === t.id),
    }));
  }, [themes, subthemes]);

  const toggleOpen = (id: string) => setOpenIds((p) => ({ ...p, [id]: !p[id] }));

  const addTheme = async () => {
    const name = newTheme.trim();
    if (!name || !user) return;
    const position = themes.length ? Math.max(...themes.map((t) => t.position)) + 1 : 0;
    const { data, error } = await supabase
      .from("op_plan_themes")
      .insert({ user_id: user.id, name, position })
      .select()
      .single();
    if (error) return toast.error(error.message);
    setThemes((p) => [...p, data as Theme]);
    setNewTheme("");
  };

  const renameTheme = async (id: string) => {
    const name = editingThemeName.trim();
    if (!name) return;
    const { error } = await supabase.from("op_plan_themes").update({ name }).eq("id", id);
    if (error) return toast.error(error.message);
    setThemes((p) => p.map((t) => (t.id === id ? { ...t, name } : t)));
    setEditingThemeId(null);
  };

  const deleteTheme = async (id: string) => {
    if (!confirm("Supprimer ce thème et tous ses sous-thèmes ?")) return;
    const { error } = await supabase.from("op_plan_themes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setThemes((p) => p.filter((t) => t.id !== id));
    setSubthemes((p) => p.filter((s) => s.theme_id !== id));
  };

  const moveTheme = async (id: string, dir: -1 | 1) => {
    const idx = themes.findIndex((t) => t.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= themes.length) return;
    const a = themes[idx];
    const b = themes[j];
    const next = [...themes];
    next[idx] = { ...b, position: a.position };
    next[j] = { ...a, position: b.position };
    setThemes(next.sort((x, y) => x.position - y.position));
    await Promise.all([
      supabase.from("op_plan_themes").update({ position: b.position }).eq("id", a.id),
      supabase.from("op_plan_themes").update({ position: a.position }).eq("id", b.id),
    ]);
  };

  const addSubtheme = async (themeId: string) => {
    const name = (newSubtheme[themeId] ?? "").trim();
    if (!name || !user) return;
    const existing = subthemes.filter((s) => s.theme_id === themeId);
    const position = existing.length ? Math.max(...existing.map((s) => s.position)) + 1 : 0;
    const { data, error } = await supabase
      .from("op_plan_subthemes")
      .insert({ user_id: user.id, theme_id: themeId, name, position, items: [] })
      .select()
      .single();
    if (error) return toast.error(error.message);
    setSubthemes((p) => [...p, data as Subtheme]);
    setNewSubtheme((p) => ({ ...p, [themeId]: "" }));
  };

  const renameSubtheme = async (id: string) => {
    const name = editingSubName.trim();
    if (!name) return;
    const { error } = await supabase.from("op_plan_subthemes").update({ name }).eq("id", id);
    if (error) return toast.error(error.message);
    setSubthemes((p) => p.map((s) => (s.id === id ? { ...s, name } : s)));
    setEditingSub(null);
  };

  const deleteSubtheme = async (id: string) => {
    const { error } = await supabase.from("op_plan_subthemes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setSubthemes((p) => p.filter((s) => s.id !== id));
  };

  const addItem = async (subId: string) => {
    const value = (newItem[subId] ?? "").trim();
    if (!value) return;
    const sub = subthemes.find((s) => s.id === subId);
    if (!sub) return;
    const items = [...sub.items, value];
    const { error } = await supabase.from("op_plan_subthemes").update({ items }).eq("id", subId);
    if (error) return toast.error(error.message);
    setSubthemes((p) => p.map((s) => (s.id === subId ? { ...s, items } : s)));
    setNewItem((p) => ({ ...p, [subId]: "" }));
  };

  const removeItem = async (subId: string, idx: number) => {
    const sub = subthemes.find((s) => s.id === subId);
    if (!sub) return;
    const items = sub.items.filter((_, i) => i !== idx);
    const { error } = await supabase.from("op_plan_subthemes").update({ items }).eq("id", subId);
    if (error) return toast.error(error.message);
    setSubthemes((p) => p.map((s) => (s.id === subId ? { ...s, items } : s)));
  };

  const seedFromTemplate = async () => {
    if (!user) return;
    if (themes.length > 0 && !confirm("Cela ajoutera les thèmes du modèle à la suite des vôtres. Continuer ?")) return;
    const base = themes.length ? Math.max(...themes.map((t) => t.position)) + 1 : 0;
    try {
      for (let i = 0; i < TEMPLATE.length; i++) {
        const t = TEMPLATE[i];
        const { data: theme, error: et } = await supabase
          .from("op_plan_themes")
          .insert({ user_id: user.id, name: t.theme, position: base + i })
          .select()
          .single();
        if (et) throw et;
        if (t.subthemes.length) {
          const payload = t.subthemes.map((s, j) => ({
            user_id: user.id,
            theme_id: (theme as Theme).id,
            name: s.name,
            position: j,
            items: s.items,
          }));
          const { error: es } = await supabase.from("op_plan_subthemes").insert(payload);
          if (es) throw es;
        }
      }
      toast.success("Modèle importé");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import échoué");
    }
  };

  // Intégrer une ligne dans le tableau Plan d'opération (crée une tâche)
  const integrateInPlan = async (themeName: string, title: string, subName?: string) => {
    if (!user) return;
    const tags = [`section:${themeName}`];
    if (subName && subName !== title) tags.push(`subtheme:${subName}`);
    const today = new Date();
    const due = new Date(today); due.setDate(due.getDate() + 14);
    const { error } = await supabase.from("tasks").insert({
      user_id: user.id,
      title,
      priority: "medium",
      status: "todo",
      source_app: "myhubpro",
      tags,
      gantt_start: today.toISOString(),
      gantt_end: due.toISOString(),
      due_date: due.toISOString(),
      attachments: [],
    });
    if (error) return toast.error(error.message);
    toast.success(`« ${title} » intégré au Plan d'opération`);
  };

  const integrateTheme = async (themeName: string) => {
    const subs = subthemes.filter((s) => themes.find((t) => t.name === themeName)?.id === s.theme_id);
    if (!subs.length) return integrateInPlan(themeName, themeName);
    for (const s of subs) {
      await integrateInPlan(themeName, s.name, s.name);
      for (const it of s.items) await integrateInPlan(themeName, it, s.name);
    }
    toast.success(`Thème « ${themeName} » entièrement intégré`);
  };

  const integrateSubtheme = async (themeName: string, sub: Subtheme) => {
    await integrateInPlan(themeName, sub.name, sub.name);
    for (const it of sub.items) await integrateInPlan(themeName, it, sub.name);
  };

  const addSelection = async () => {
    if (!user) return;
    if (selected.size === 0) return toast.error("Aucune ligne sélectionnée");
    let count = 0;
    for (const t of themes) {
      const themeKey = `theme:${t.id}`;
      const themeChecked = selected.has(themeKey);
      const subs = subthemes.filter((s) => s.theme_id === t.id);
      // If theme itself is checked (without any sub/item), create a generic task
      if (themeChecked && !subs.some((s) => selected.has(`sub:${s.id}`) || s.items.some((_, i) => selected.has(`item:${s.id}:${i}`)))) {
        await integrateInPlan(t.name, t.name);
        count++;
      }
      for (const s of subs) {
        const subKey = `sub:${s.id}`;
        if (selected.has(subKey)) {
          await integrateInPlan(t.name, s.name, s.name);
          count++;
        }
        for (let i = 0; i < s.items.length; i++) {
          if (selected.has(`item:${s.id}:${i}`)) {
            await integrateInPlan(t.name, s.items[i], s.name);
            count++;
          }
        }
      }
    }
    setSelected(new Set());
    toast.success(`${count} ligne${count > 1 ? "s" : ""} ajoutée${count > 1 ? "s" : ""} au Plan d'opération`);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4 text-primary" /> Configuration du Plan d'opération
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Définissez les thèmes et sous-thèmes (et leurs items). Cochez les lignes à ajouter au tableau Plan d'opération, puis cliquez sur « Ajouter la sélection ».
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="flex flex-1 gap-2 min-w-[220px]">
              <Input
                value={newTheme}
                onChange={(e) => setNewTheme(e.target.value)}
                placeholder="Nom du thème (ex. CHEFFERIE DE SERVICE)"
                onKeyDown={(e) => e.key === "Enter" && addTheme()}
              />
              <Button onClick={addTheme} className="gap-1">
                <Plus className="h-4 w-4" /> Thème
              </Button>
            </div>
            <Button variant="outline" onClick={seedFromTemplate} className="gap-1">
              <Sparkles className="h-4 w-4" /> Importer le modèle
            </Button>
            <Button onClick={addSelection} disabled={selected.size === 0} className="gap-1">
              <Send className="h-4 w-4" /> Ajouter la sélection{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
          </div>

          {loading ? (
            <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Chargement…
            </div>
          ) : grouped.length === 0 ? (
            <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Aucun thème pour le moment. Ajoutez-en un ou importez le modèle.
            </div>
          ) : (
            <div className="space-y-2">
              {grouped.map(({ theme, subs }, idx) => {
                const isOpen = openIds[theme.id] ?? true;
                return (
                  <div key={theme.id} className="rounded-md border bg-card">
                    <div className="flex items-center gap-1 border-b bg-muted/30 px-2 py-1.5">
                      <Checkbox
                        checked={isSel(`theme:${theme.id}`)}
                        onCheckedChange={() => toggleSel(`theme:${theme.id}`)}
                        className="shrink-0"
                        aria-label="Sélectionner le thème"
                      />
                      <button
                        onClick={() => toggleOpen(theme.id)}
                        className="rounded p-1 hover:bg-accent shrink-0"
                        aria-label="Plier/déplier"
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      {editingThemeId === theme.id ? (
                        <>
                          <Input
                            value={editingThemeName}
                            onChange={(e) => setEditingThemeName(e.target.value)}
                            className="h-7 flex-1 min-w-0"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") renameTheme(theme.id);
                              if (e.key === "Escape") setEditingThemeId(null);
                            }}
                          />
                          <Button size="icon" variant="ghost" onClick={() => renameTheme(theme.id)} className="h-7 w-7 shrink-0">
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setEditingThemeId(null)} className="h-7 w-7 shrink-0">
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm font-semibold uppercase tracking-wide truncate min-w-0">{theme.name}</span>
                          <Badge variant="secondary" className="text-[10px] hidden sm:inline-flex">
                            {subs.length}
                          </Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 hidden sm:inline-flex"
                            onClick={() => moveTheme(theme.id, -1)}
                            disabled={idx === 0}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 hidden sm:inline-flex"
                            onClick={() => moveTheme(theme.id, 1)}
                            disabled={idx === grouped.length - 1}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => {
                              setEditingThemeId(theme.id);
                              setEditingThemeName(theme.name);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            onClick={() => deleteTheme(theme.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>

                    {isOpen && (
                      <div className="space-y-1.5 p-2">
                        {subs.map((s) => (
                          <div key={s.id} className={cn("rounded border bg-background")}>
                            <div className="flex items-center gap-1 px-2 py-1.5">
                              {editingSub === s.id ? (
                                <>
                                  <Input
                                    value={editingSubName}
                                    onChange={(e) => setEditingSubName(e.target.value)}
                                    className="h-7 flex-1"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") renameSubtheme(s.id);
                                      if (e.key === "Escape") setEditingSub(null);
                                    }}
                                  />
                                  <Button size="icon" variant="ghost" onClick={() => renameSubtheme(s.id)} className="h-7 w-7">
                                    <Check className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button size="icon" variant="ghost" onClick={() => setEditingSub(null)} className="h-7 w-7">
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              ) : (
                              <>
                                <span className="flex-1 text-sm truncate min-w-0">{s.name}</span>
                                {s.items.length > 0 && (
                                  <Badge variant="outline" className="text-[10px] hidden sm:inline-flex">
                                    {s.items.length} item{s.items.length > 1 ? "s" : ""}
                                  </Badge>
                                )}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  onClick={() => {
                                    setEditingSub(s.id);
                                    setEditingSubName(s.name);
                                  }}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1 px-2 text-primary"
                                  onClick={() => integrateSubtheme(theme.name, s)}
                                  title="Intégrer ce sous-thème (et ses items) dans le tableau Plan d'opération"
                                >
                                  <Send className="h-3.5 w-3.5" /> <span className="hidden sm:inline text-xs">Intégrer</span>
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-destructive"
                                  onClick={() => deleteSubtheme(s.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                              )}
                            </div>
                            {/* Items list */}
                            <div className="space-y-1 border-t bg-muted/20 px-2 py-1.5">
                              {s.items.map((it, i) => (
                                <div key={i} className="flex items-center gap-1 text-xs">
                                  <span className="flex-1 truncate">• {it}</span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 text-primary"
                                    onClick={() => integrateInPlan(theme.name, it, s.name)}
                                    title="Intégrer cet item dans le tableau Plan d'opération"
                                  >
                                    <Send className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6"
                                    onClick={() => removeItem(s.id, i)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ))}
                              <div className="flex gap-1">
                                <Input
                                  placeholder="Ajouter un item…"
                                  value={newItem[s.id] ?? ""}
                                  onChange={(e) => setNewItem((p) => ({ ...p, [s.id]: e.target.value }))}
                                  className="h-7 text-xs"
                                  onKeyDown={(e) => e.key === "Enter" && addItem(s.id)}
                                />
                                <Button size="sm" variant="outline" onClick={() => addItem(s.id)} className="h-7 px-2">
                                  <Plus className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                        <div className="flex gap-1 pt-1">
                          <Input
                            placeholder="Nouveau sous-thème…"
                            value={newSubtheme[theme.id] ?? ""}
                            onChange={(e) =>
                              setNewSubtheme((p) => ({ ...p, [theme.id]: e.target.value }))
                            }
                            className="h-7 text-xs"
                            onKeyDown={(e) => e.key === "Enter" && addSubtheme(theme.id)}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => addSubtheme(theme.id)}
                            className="h-7 px-2"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
