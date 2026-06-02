import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Step1Profile, type Step1Data } from "@/components/onboarding/step1-profile";
import { Step2Accounts } from "@/components/onboarding/step2-accounts";
import { Step3Calendars } from "@/components/onboarding/step3-calendars";
import { Step4Contacts } from "@/components/onboarding/step4-contacts";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingPage,
});

const TOTAL_STEPS = 7;
const STEP_LABELS = ["Profil", "Comptes email", "Agendas", "Contacts", "Étape 5", "Étape 6", "Étape 7"];

function OnboardingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [ready, setReady] = useState(false);
  const [initialProfile, setInitialProfile] = useState({ firstName: "", lastName: "", avatarUrl: null as string | null });
  const [step1Data, setStep1Data] = useState<Step1Data | null>(null);
  const [hasEmailAccount, setHasEmailAccount] = useState(false);
  const [hasOutlookAccount, setHasOutlookAccount] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Charge le profil + vérifie si l'onboarding est déjà terminé
  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("first_name,last_name,avatar_url,onboarding_completed_at")
        .eq("id", user.id)
        .maybeSingle();
      if (data?.onboarding_completed_at) {
        navigate({ to: "/inbox", replace: true });
        return;
      }
      setInitialProfile({
        firstName: data?.first_name ?? "",
        lastName: data?.last_name ?? "",
        avatarUrl: data?.avatar_url ?? null,
      });
      setReady(true);
    })();
  }, [user, navigate]);

  // Refresh des indicateurs (compte email, compte outlook) à chaque changement d'étape
  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data } = await supabase.from("accounts").select("type");
      const list = (data ?? []) as { type: string }[];
      setHasEmailAccount(list.length > 0);
      setHasOutlookAccount(list.some((a) => a.type === "outlook"));
    })();
  }, [user, step]);

  const goNext = () => setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const finish = async () => {
    if (!user) return;
    if (!hasEmailAccount) {
      toast.error("Au moins un compte email est requis pour terminer");
      setStep(2);
      return;
    }
    setFinishing(true);
    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq("id", user.id);
    setFinishing(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Bienvenue dans MyHub Pro !");
    navigate({ to: "/inbox" });
  };

  if (!ready) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Sparkles className="h-6 w-6 animate-pulse text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] py-6 sm:py-10">
      <div className="mx-auto w-full max-w-3xl px-4">
        <ProgressHeader step={step} />

        <Card className="mt-6 p-5 sm:p-8">
          {step === 1 && (
            <Step1Profile
              initialFirstName={initialProfile.firstName}
              initialLastName={initialProfile.lastName}
              initialAvatarUrl={initialProfile.avatarUrl}
              onContinue={(d) => {
                setStep1Data(d);
                goNext();
              }}
            />
          )}

          {step === 2 && <Step2Accounts onContinue={goNext} />}

          {step === 3 && (
            <Step3Calendars onContinue={goNext} onSkip={goNext} outlookPreconnected={hasOutlookAccount} />
          )}

          {step === 4 && (
            <Step4Contacts onContinue={goNext} onSkip={goNext} outlookPreconnected={hasOutlookAccount} />
          )}

          {step >= 5 && step <= 7 && (
            <PlaceholderStep
              n={step}
              onContinue={step < TOTAL_STEPS ? goNext : finish}
              onSkip={step < TOTAL_STEPS ? goNext : undefined}
              canFinish={step === TOTAL_STEPS}
              finishing={finishing}
              hasEmailAccount={hasEmailAccount}
            />
          )}
        </Card>

        {step > 1 && (
          <div className="mt-4 flex justify-center">
            <Button variant="ghost" size="sm" onClick={goBack} disabled={finishing}>
              <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Retour
            </Button>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          {step1Data?.firstName ? `Connecté en tant que ${step1Data.firstName}` : null}
        </p>
      </div>
    </div>
  );
}

function ProgressHeader({ step }: { step: number }) {
  const pct = useMemo(() => Math.round((step / TOTAL_STEPS) * 100), [step]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">
          Étape {step} sur {TOTAL_STEPS} — <span className="text-foreground">{STEP_LABELS[step - 1]}</span>
        </p>
        <p className="text-xs text-muted-foreground">{pct}%</p>
      </div>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
          const n = i + 1;
          const done = n < step;
          const current = n === step;
          return (
            <div key={n} className="flex flex-1 items-center gap-1.5">
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition",
                  done && "border-primary bg-primary text-primary-foreground",
                  current && "border-primary bg-background text-primary",
                  !done && !current && "border-border bg-background text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : n}
              </div>
              {n < TOTAL_STEPS && (
                <div className={cn("h-0.5 flex-1 rounded-full", done ? "bg-primary" : "bg-border")} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlaceholderStep({
  n,
  onContinue,
  onSkip,
  canFinish,
  finishing,
  hasEmailAccount,
}: {
  n: number;
  onContinue: () => void;
  onSkip?: () => void;
  canFinish: boolean;
  finishing: boolean;
  hasEmailAccount: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Étape {n}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cette étape sera configurée dans la prochaine livraison du wizard.
        </p>
      </div>

      <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center">
        <Sparkles className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          Contenu à venir
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        {onSkip && (
          <Button variant="ghost" onClick={onSkip}>
            Passer cette étape
          </Button>
        )}
        <Button
          onClick={onContinue}
          disabled={(canFinish && !hasEmailAccount) || finishing}
          size="lg"
        >
          {canFinish ? (finishing ? "Finalisation…" : "Terminer le wizard") : "Continuer"}
        </Button>
      </div>

      {canFinish && !hasEmailAccount && (
        <p className="text-center text-xs text-destructive">
          Au moins 1 compte email doit être configuré (étape 2) pour terminer.
        </p>
      )}
    </div>
  );
}
