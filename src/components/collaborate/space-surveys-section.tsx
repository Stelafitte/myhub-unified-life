import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2,
  Plus,
  ClipboardList,
  Copy,
  ExternalLink,
  Trash2,
  Eye,
  Lock,
  Unlock,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  listSpaceSurveys,
  createSpaceSurvey,
  updateSpaceSurveyStatus,
  deleteSpaceSurvey,
  getSpaceSurveyDetail,
} from "@/lib/collab.functions";

interface Props {
  spaceId: string;
}

type QType = "text" | "long_text" | "single_choice" | "multi_choice" | "rating" | "yes_no";

const TYPE_LABELS: Record<QType, string> = {
  text: "Texte court",
  long_text: "Texte long",
  single_choice: "Choix unique",
  multi_choice: "Choix multiple",
  rating: "Note (1-5)",
  yes_no: "Oui / Non",
};

interface DraftQuestion {
  label: string;
  type: QType;
  options: string[];
  required: boolean;
}

function emptyQuestion(): DraftQuestion {
  return { label: "", type: "text", options: [], required: false };
}

export function SpaceSurveysSection({ spaceId }: Props) {
  const listFn = useServerFn(listSpaceSurveys);
  const createFn = useServerFn(createSpaceSurvey);
  const statusFn = useServerFn(updateSpaceSurveyStatus);
  const deleteFn = useServerFn(deleteSpaceSurvey);
  const detailFn = useServerFn(getSpaceSurveyDetail);
  const qc = useQueryClient();
  const queryKey = ["space-surveys", spaceId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { spaceId } }),
  });
  const surveys = data?.surveys ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [anonymous, setAnonymous] = useState(true);
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion()]);
  const [saving, setSaving] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const detailQ = useQuery({
    queryKey: ["space-survey-detail", detailId],
    queryFn: () => detailFn({ data: { id: detailId! } }),
    enabled: !!detailId,
  });

  const refresh = () => qc.invalidateQueries({ queryKey });

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setDeadline("");
    setAnonymous(true);
    setQuestions([emptyQuestion()]);
  };

  const handleCreate = async () => {
    if (!title.trim()) return toast.error("Titre requis");
    const cleanQs = questions
      .filter((q) => q.label.trim())
      .map((q) => ({
        label: q.label.trim(),
        type: q.type,
        options:
          q.type === "single_choice" || q.type === "multi_choice"
            ? q.options.map((o) => o.trim()).filter(Boolean)
            : undefined,
        required: q.required,
      }));
    if (cleanQs.length === 0) return toast.error("Au moins une question");
    for (const q of cleanQs) {
      if ((q.type === "single_choice" || q.type === "multi_choice") && (!q.options || q.options.length < 2)) {
        return toast.error("Les questions à choix doivent avoir au moins 2 options");
      }
    }
    setSaving(true);
    try {
      await createFn({
        data: {
          spaceId,
          title: title.trim(),
          description: description.trim() || undefined,
          deadline: deadline ? new Date(deadline).toISOString() : undefined,
          allow_anonymous: anonymous,
          questions: cleanQs,
        },
      });
      toast.success("Sondage créé");
      setCreateOpen(false);
      resetForm();
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (id: string, current: string) => {
    try {
      await statusFn({
        data: { id, status: current === "open" ? "closed" : "open" },
      });
      toast.success(current === "open" ? "Sondage clôturé" : "Sondage rouvert");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce sondage et toutes ses réponses ?")) return;
    try {
      await deleteFn({ data: { id } });
      toast.success("Sondage supprimé");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/survey/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Lien copié");
  };

  const updateQuestion = (idx: number, patch: Partial<DraftQuestion>) => {
    setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  };

  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Sondages d'opinion</h3>
          <Badge variant="secondary">{surveys.length}</Badge>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Nouveau
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : surveys.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          Aucun sondage d'opinion. Créez-en un pour recueillir des avis externes.
        </p>
      ) : (
        <ul className="divide-y">
          {surveys.map((s) => (
            <li key={s.id} className="py-2 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{s.title}</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${s.status === "open" ? "bg-emerald-100 text-emerald-800" : "bg-muted"}`}
                  >
                    {s.status === "open" ? "Ouvert" : "Clôturé"}
                  </Badge>
                  {s.allow_anonymous && (
                    <Badge variant="outline" className="text-[10px]">Anonyme OK</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                  <span>{s.questions_count} question(s)</span>
                  <span>{s.responses_count} réponse(s)</span>
                  {s.deadline && (
                    <span>jusqu'au {format(new Date(s.deadline), "d MMM HH:mm", { locale: fr })}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-0.5">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copyLink(s.public_token)} title="Copier le lien">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" asChild title="Ouvrir le sondage">
                  <a href={`/survey/${s.public_token}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDetailId(s.id)} title="Voir les réponses">
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => toggleStatus(s.id, s.status)}
                  title={s.status === "open" ? "Clôturer" : "Rouvrir"}
                >
                  {s.status === "open" ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onClick={() => handleDelete(s.id)} title="Supprimer">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nouveau sondage d'opinion</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Titre</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Satisfaction client Q1" />
            </div>
            <div>
              <Label className="text-xs">Description (optionnelle)</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Date limite (optionnelle)</Label>
                <Input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <Switch checked={anonymous} onCheckedChange={setAnonymous} id="anon-switch" />
                <Label htmlFor="anon-switch" className="text-xs cursor-pointer">
                  Autoriser les réponses anonymes
                </Label>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Questions</Label>
                <Button size="sm" variant="outline" onClick={() => setQuestions((p) => [...p, emptyQuestion()])}>
                  <Plus className="h-3 w-3 mr-1" /> Ajouter
                </Button>
              </div>
              {questions.map((q, idx) => (
                <Card key={idx} className="p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground mt-2">#{idx + 1}</span>
                    <div className="flex-1 space-y-2">
                      <Input
                        value={q.label}
                        onChange={(e) => updateQuestion(idx, { label: e.target.value })}
                        placeholder="Libellé de la question"
                      />
                      <div className="flex gap-2 flex-wrap">
                        <Select value={q.type} onValueChange={(v) => updateQuestion(idx, { type: v as QType, options: [] })}>
                          <SelectTrigger className="w-[180px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(TYPE_LABELS) as QType[]).map((t) => (
                              <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <label className="text-xs flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={q.required}
                            onChange={(e) => updateQuestion(idx, { required: e.target.checked })}
                          />
                          Obligatoire
                        </label>
                      </div>
                      {(q.type === "single_choice" || q.type === "multi_choice") && (
                        <div className="space-y-1">
                          {q.options.map((opt, oi) => (
                            <div key={oi} className="flex gap-1">
                              <Input
                                value={opt}
                                onChange={(e) => {
                                  const next = [...q.options];
                                  next[oi] = e.target.value;
                                  updateQuestion(idx, { options: next });
                                }}
                                placeholder={`Option ${oi + 1}`}
                                className="h-8 text-xs"
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => updateQuestion(idx, { options: q.options.filter((_, i) => i !== oi) })}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => updateQuestion(idx, { options: [...q.options, ""] })}
                          >
                            <Plus className="h-3 w-3 mr-1" /> Option
                          </Button>
                        </div>
                      )}
                    </div>
                    {questions.length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-red-600"
                        onClick={() => setQuestions((p) => p.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Créer le sondage
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail / responses dialog */}
      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detailQ.data?.survey?.title ?? "Sondage"}</DialogTitle>
          </DialogHeader>
          {detailQ.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !detailQ.data ? null : (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                {detailQ.data.responses.length} réponse(s) · {detailQ.data.questions.length} question(s)
              </div>
              {detailQ.data.responses.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Aucune réponse pour le moment. Partagez le lien public pour collecter des avis.
                </p>
              ) : (
                <div className="space-y-3">
                  {detailQ.data.responses.map((r) => (
                    <Card key={r.id} className="p-3 space-y-2">
                      <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {r.respondent_name ?? "Anonyme"}
                        </span>
                        {r.respondent_email && <span>· {r.respondent_email}</span>}
                        <span className="ml-auto">
                          {format(new Date(r.submitted_at), "d MMM HH:mm", { locale: fr })}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {detailQ.data.questions.map((q) => {
                          const ans = (r.answers as Record<string, unknown>)?.[q.id];
                          const display = Array.isArray(ans) ? ans.join(", ") : String(ans ?? "—");
                          return (
                            <div key={q.id} className="text-xs">
                              <div className="text-muted-foreground">{q.label}</div>
                              <div className="whitespace-pre-wrap">{display}</div>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
