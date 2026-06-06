import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { getPublicSurvey, submitPublicSurveyResponse } from "@/lib/collab.functions";

export const Route = createFileRoute("/survey/$token")({
  head: () => ({
    meta: [
      { title: "Sondage" },
      { name: "description", content: "Répondez à ce sondage public." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PublicSurveyPage,
});

type Question = {
  id: string;
  label: string;
  type: string;
  options: unknown;
  required: boolean;
  position: number;
};

function PublicSurveyPage() {
  const { token } = Route.useParams();
  const fn = useServerFn(getPublicSurvey);
  const submitFn = useServerFn(submitPublicSurveyResponse);
  const { data, isLoading } = useQuery({
    queryKey: ["public-survey", token],
    queryFn: () => fn({ data: { token } }),
  });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [step, setStep] = useState(0); // 0 = identity, 1..N = questions, N+1 = done
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const questions: Question[] = useMemo(
    () => (data?.questions ?? []) as Question[],
    [data],
  );
  const survey = data?.survey;
  const space = data?.space;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Chargement…
      </div>
    );
  }

  if (!survey) {
    return (
      <div className="max-w-xl mx-auto py-16 px-4 text-center">
        <h1 className="text-xl font-semibold mb-2">Sondage introuvable</h1>
        <p className="text-sm text-muted-foreground">Le lien est invalide.</p>
      </div>
    );
  }

  if (survey.status !== "open") {
    return (
      <div className="max-w-xl mx-auto py-16 px-4 text-center">
        <h1 className="text-xl font-semibold mb-2">{survey.title}</h1>
        <p className="text-sm text-muted-foreground">Ce sondage est clôturé.</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-xl mx-auto py-16 px-4 text-center space-y-3">
        <CheckCircle2 className="h-12 w-12 mx-auto text-primary" />
        <h1 className="text-xl font-semibold">Merci pour votre réponse !</h1>
        <p className="text-sm text-muted-foreground">
          Votre participation a bien été enregistrée.
        </p>
      </div>
    );
  }

  const totalSteps = questions.length + 1; // identity + N questions
  const progress = Math.round(((step + 1) / (totalSteps + 1)) * 100);

  const canProceedIdentity =
    survey.allow_anonymous || /.+@.+\..+/.test(email.trim());

  const currentQuestion = step > 0 ? questions[step - 1] : null;

  const isAnswered = (q: Question) => {
    const v = answers[q.id];
    if (!q.required) return true;
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "string") return v.trim().length > 0;
    return true;
  };

  const next = () => {
    if (step === 0 && !canProceedIdentity) {
      toast.error("Email requis");
      return;
    }
    if (currentQuestion && !isAnswered(currentQuestion)) {
      toast.error("Cette question est obligatoire");
      return;
    }
    setStep((s) => s + 1);
  };

  const prev = () => setStep((s) => Math.max(0, s - 1));

  const submit = async () => {
    if (currentQuestion && !isAnswered(currentQuestion)) {
      toast.error("Cette question est obligatoire");
      return;
    }
    setSubmitting(true);
    try {
      await submitFn({
        data: {
          token,
          respondent_name: name.trim() || null,
          respondent_email: email.trim() || null,
          answers,
        },
      });
      setDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  };

  const isLast = step === questions.length;

  return (
    <div className="max-w-xl mx-auto py-8 px-4 space-y-4">
      <header className="space-y-2">
        {space && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span style={{ color: space.color ?? undefined }}>{space.icon ?? "📁"}</span>
            <span>{space.name}</span>
          </div>
        )}
        <h1 className="text-xl font-semibold">{survey.title}</h1>
        {survey.description && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {survey.description}
          </p>
        )}
        {survey.deadline && (
          <p className="text-xs text-muted-foreground">
            Date limite : {format(new Date(survey.deadline), "d MMM yyyy HH:mm", { locale: fr })}
          </p>
        )}
        <Progress value={progress} className="h-1.5" />
        <p className="text-xs text-muted-foreground">
          Étape {step + 1} / {totalSteps}
        </p>
      </header>

      <Card className="p-4 space-y-4">
        {step === 0 ? (
          <div className="space-y-3">
            <h2 className="font-medium text-sm">Vos informations</h2>
            <div>
              <Label className="text-xs">Nom {survey.allow_anonymous && "(optionnel)"}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Votre nom" />
            </div>
            <div>
              <Label className="text-xs">
                Email {survey.allow_anonymous ? "(optionnel)" : <span className="text-destructive">*</span>}
              </Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
              />
            </div>
            {survey.allow_anonymous && (
              <p className="text-xs text-muted-foreground">
                Vous pouvez répondre anonymement. Si vous fournissez un email, vous ne pourrez voter qu'une fois.
              </p>
            )}
          </div>
        ) : currentQuestion ? (
          <QuestionRenderer
            question={currentQuestion}
            value={answers[currentQuestion.id]}
            onChange={(v) =>
              setAnswers((a) => ({ ...a, [currentQuestion.id]: v }))
            }
          />
        ) : null}
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={prev} disabled={step === 0}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Précédent
        </Button>
        {isLast ? (
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Envoyer
          </Button>
        ) : (
          <Button onClick={next}>
            Suivant <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}

function QuestionRenderer({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const opts = Array.isArray(question.options) ? (question.options as string[]) : [];

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm font-medium">
          {question.label}
          {question.required && <span className="text-destructive ml-1">*</span>}
        </Label>
      </div>

      {question.type === "text" && (
        <Input
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Votre réponse"
        />
      )}

      {question.type === "long_text" && (
        <Textarea
          rows={5}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Votre réponse"
        />
      )}

      {question.type === "single_choice" && (
        <RadioGroup
          value={(value as string) ?? ""}
          onValueChange={(v) => onChange(v)}
          className="space-y-1.5"
        >
          {opts.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <RadioGroupItem value={o} id={`${question.id}-${i}`} />
              <Label htmlFor={`${question.id}-${i}`} className="text-sm font-normal cursor-pointer">
                {o}
              </Label>
            </div>
          ))}
        </RadioGroup>
      )}

      {question.type === "multi_choice" && (
        <div className="space-y-1.5">
          {opts.map((o, i) => {
            const arr = Array.isArray(value) ? (value as string[]) : [];
            const checked = arr.includes(o);
            return (
              <div key={i} className="flex items-center gap-2">
                <Checkbox
                  id={`${question.id}-${i}`}
                  checked={checked}
                  onCheckedChange={(c) => {
                    if (c) onChange([...arr, o]);
                    else onChange(arr.filter((x) => x !== o));
                  }}
                />
                <Label htmlFor={`${question.id}-${i}`} className="text-sm font-normal cursor-pointer">
                  {o}
                </Label>
              </div>
            );
          })}
        </div>
      )}

      {question.type === "rating" && (
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <Button
              key={n}
              type="button"
              variant={value === n ? "default" : "outline"}
              size="sm"
              onClick={() => onChange(n)}
              className="w-10"
            >
              {n}
            </Button>
          ))}
        </div>
      )}

      {question.type === "yes_no" && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant={value === "yes" ? "default" : "outline"}
            size="sm"
            onClick={() => onChange("yes")}
          >
            Oui
          </Button>
          <Button
            type="button"
            variant={value === "no" ? "default" : "outline"}
            size="sm"
            onClick={() => onChange("no")}
          >
            Non
          </Button>
        </div>
      )}
    </div>
  );
}
