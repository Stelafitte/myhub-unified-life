import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Sparkles, User, Mail, Bell, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingPage,
});

const STEPS = [
  { id: 1, title: "Bienvenue", icon: Sparkles },
  { id: 2, title: "Profil", icon: User },
  { id: 3, title: "Comptes email", icon: Mail },
  { id: 4, title: "Notifications", icon: Bell },
  { id: 5, title: "Confidentialité", icon: ShieldCheck },
];

function OnboardingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifPush, setNotifPush] = useState(false);
  const [acceptRgpd, setAcceptRgpd] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("first_name,last_name,onboarding_completed_at").eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        if (data?.onboarding_completed_at) navigate({ to: "/inbox", replace: true });
        if (data?.first_name) setFirstName(data.first_name);
        if (data?.last_name) setLastName(data.last_name);
      });
  }, [user, navigate]);

  const finish = async () => {
    if (!user) return;
    setBusy(true);
    await supabase.from("profiles").update({
      first_name: firstName,
      last_name: lastName,
      display_name: `${firstName} ${lastName}`.trim() || null,
      onboarding_completed_at: new Date().toISOString(),
    }).eq("id", user.id);
    setBusy(false);
    toast.success("Bienvenue dans MyHub Pro !");
    navigate({ to: "/inbox" });
  };

  const progress = (step / STEPS.length) * 100;
  const current = STEPS[step - 1];
  const Icon = current.icon;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Progress value={progress} />
        <p className="mt-2 text-xs text-muted-foreground">Étape {step} sur {STEPS.length} — {current.title}</p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-6 w-6" />
          </div>
          <CardTitle>{current.title}</CardTitle>
          <CardDescription>
            {step === 1 && "Bienvenue dans MyHub Pro, votre hub de productivité tout-en-un."}
            {step === 2 && "Dites-nous qui vous êtes."}
            {step === 3 && "Connectez votre premier compte email pour démarrer."}
            {step === 4 && "Choisissez comment être notifié."}
            {step === 5 && "Acceptez notre politique de confidentialité."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 1 && (
            <div className="space-y-2 text-sm">
              <p>📥 Centralisez emails, tâches, réunions et documents</p>
              <p>🤖 Tri intelligent par IA</p>
              <p>🔒 Vos données restent privées</p>
            </div>
          )}
          {step === 2 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Prénom</Label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Nom</Label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-2 text-sm">
              <p>Vous pourrez ajouter vos comptes email (Gmail, IMAP…) depuis la section <strong>Paramètres → Comptes</strong>.</p>
              <Button variant="outline" onClick={() => navigate({ to: "/settings" })}>Aller aux paramètres</Button>
            </div>
          )}
          {step === 4 && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={notifEmail} onCheckedChange={(v) => setNotifEmail(!!v)} />
                Notifications par email
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={notifPush} onCheckedChange={(v) => setNotifPush(!!v)} />
                Notifications push (navigateur)
              </label>
            </div>
          )}
          {step === 5 && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={acceptRgpd} onCheckedChange={(v) => setAcceptRgpd(!!v)} />
              <span>
                J'accepte la politique de confidentialité et le traitement de mes données conformément au RGPD.
                Mes données sont stockées de manière sécurisée et je peux les exporter ou les supprimer à tout moment.
              </span>
            </label>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1 || busy}>
              Précédent
            </Button>
            {step < STEPS.length ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={busy}>Suivant</Button>
            ) : (
              <Button onClick={finish} disabled={busy || !acceptRgpd}>Terminer</Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
