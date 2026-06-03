import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sparkles, User, Mail, Calendar, Plug, Brain, CheckCircle2, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingPage,
});

const STEPS = [
  { id: 1, title: "Bienvenue", icon: Sparkles },
  { id: 2, title: "Profil", icon: User },
  { id: 3, title: "Comptes email", icon: Mail },
  { id: 4, title: "Agendas & Contacts", icon: Calendar },
  { id: 5, title: "Intégrations", icon: Plug },
  { id: 6, title: "Intelligence IA", icon: Brain },
  { id: 7, title: "Récapitulatif", icon: CheckCircle2 },
];

type AiProvider = "openai-gpt4o-mini" | "anthropic-haiku" | "anthropic-sonnet";

function OnboardingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);

  // Étape 4 — Agendas & Contacts
  const [calGoogle, setCalGoogle] = useState(false);
  const [calOutlook, setCalOutlook] = useState(false);
  const [calIcloud, setCalIcloud] = useState(false);
  const [contGoogle, setContGoogle] = useState(false);
  const [contOutlook, setContOutlook] = useState(false);
  const [contIcloud, setContIcloud] = useState(false);
  const [syncDirection, setSyncDirection] = useState<"read" | "bidir">("bidir");

  // Étape 5 — Intégrations (placeholder, optionnel)
  const [intSlack, setIntSlack] = useState(false);
  const [intNotion, setIntNotion] = useState(false);
  const [intDrive, setIntDrive] = useState(false);

  // Étape 6 — IA
  const [useOwnKey, setUseOwnKey] = useState(false);
  const [aiProvider, setAiProvider] = useState<AiProvider>("openai-gpt4o-mini");
  const [aiKey, setAiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<"idle" | "ok" | "ko" | "testing">("idle");
  const [aiClassify, setAiClassify] = useState(true);
  const [aiSummary, setAiSummary] = useState(true);
  const [aiTaskSuggest, setAiTaskSuggest] = useState(true);
  const [aiAutoReply, setAiAutoReply] = useState(true);
  const [aiNewsletter, setAiNewsletter] = useState(true);
  const [hdsLevel, setHdsLevel] = useState<"strict" | "normal" | "permissive">("normal");

  // Étape 7 — RGPD
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

  const testApiKey = async () => {
    setKeyStatus("testing");
    // Validation locale basique (longueur + préfixe) — pas d'appel réseau pour éviter
    // de modifier les Edge Functions. La vraie validation aura lieu au 1er usage.
    await new Promise((r) => setTimeout(r, 500));
    const valid = aiKey.trim().length >= 20 && /^(sk-|claude-|anthropic|sk_)/i.test(aiKey.trim());
    setKeyStatus(valid ? "ok" : "ko");
    if (valid) toast.success("Format de clé valide");
    else toast.error("Format de clé non reconnu");
  };

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
  const current = useMemo(() => STEPS[step - 1], [step]);
  const Icon = current.icon;
  const isLast = step === STEPS.length;
  const canSkip = step === 4 || step === 5;

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
            {step === 4 && "Synchronisez vos agendas et contacts (optionnel)."}
            {step === 5 && "Connectez vos outils favoris (optionnel)."}
            {step === 6 && "Configurez l'intelligence artificielle de MyHub Pro."}
            {step === 7 && "Dernière étape : confirmez vos préférences."}
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
            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                <p className="font-medium">📅 Agendas</p>
                <label className="flex items-center gap-2">
                  <Checkbox checked={calGoogle} onCheckedChange={(v) => setCalGoogle(!!v)} />
                  Google Calendar <span className="text-xs text-muted-foreground">(OAuth2 Google)</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked={calOutlook} onCheckedChange={(v) => setCalOutlook(!!v)} />
                  Outlook Calendar <span className="text-xs text-muted-foreground">(OAuth2 Microsoft)</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked={calIcloud} onCheckedChange={(v) => setCalIcloud(!!v)} />
                  iCloud Calendar <span className="text-xs text-muted-foreground">(CalDAV)</span>
                </label>
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="font-medium">👥 Contacts</p>
                <label className="flex items-center gap-2">
                  <Checkbox checked={contGoogle} onCheckedChange={(v) => setContGoogle(!!v)} />
                  Google Contacts <span className="text-xs text-muted-foreground">(OAuth2 Google)</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked={contOutlook} onCheckedChange={(v) => setContOutlook(!!v)} />
                  Outlook Contacts <span className="text-xs text-muted-foreground">(OAuth2 Microsoft)</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked={contIcloud} onCheckedChange={(v) => setContIcloud(!!v)} />
                  iCloud Contacts <span className="text-xs text-muted-foreground">(CardDAV)</span>
                </label>
              </div>
              <Separator />
              <div className="space-y-1.5">
                <Label>Direction de synchronisation</Label>
                <Select value={syncDirection} onValueChange={(v) => setSyncDirection(v as "read" | "bidir")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">Lecture seule</SelectItem>
                    <SelectItem value="bidir">Bidirectionnel</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">Tout est optionnel — vous pourrez configurer cela plus tard dans les Paramètres.</p>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">Connectez vos outils tiers favoris (optionnel) :</p>
              <label className="flex items-center gap-2">
                <Checkbox checked={intSlack} onCheckedChange={(v) => setIntSlack(!!v)} />
                Slack
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={intNotion} onCheckedChange={(v) => setIntNotion(!!v)} />
                Notion
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={intDrive} onCheckedChange={(v) => setIntDrive(!!v)} />
                Google Drive
              </label>
              <p className="text-xs text-muted-foreground">Vous pourrez ajouter d'autres intégrations depuis Paramètres → Intégrations.</p>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium flex items-center gap-2">
                    <Badge variant="secondary">⚡ IA incluse</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Aucune configuration requise — l'IA Lovable est prête à l'emploi.</p>
                </div>
                <Switch checked={useOwnKey} onCheckedChange={setUseOwnKey} aria-label="Utiliser ma propre clé API" />
              </div>

              {useOwnKey && (
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="space-y-1.5">
                    <Label>Fournisseur</Label>
                    <Select value={aiProvider} onValueChange={(v) => setAiProvider(v as AiProvider)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai-gpt4o-mini">OpenAI GPT-4o-mini</SelectItem>
                        <SelectItem value="anthropic-haiku">Anthropic Claude Haiku</SelectItem>
                        <SelectItem value="anthropic-sonnet">Anthropic Claude Sonnet</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Clé API</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showKey ? "text" : "password"}
                          value={aiKey}
                          onChange={(e) => { setAiKey(e.target.value); setKeyStatus("idle"); }}
                          placeholder="sk-..."
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey((s) => !s)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          aria-label={showKey ? "Masquer la clé" : "Afficher la clé"}
                        >
                          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <Button variant="outline" onClick={testApiKey} disabled={!aiKey || keyStatus === "testing"}>
                        {keyStatus === "testing" ? "Test…" : "Tester la clé"}
                      </Button>
                    </div>
                    {keyStatus === "ok" && <p className="text-xs text-green-600">✓ Format valide</p>}
                    {keyStatus === "ko" && <p className="text-xs text-destructive">✗ Format invalide</p>}
                  </div>
                </div>
              )}

              <Separator />
              <div className="space-y-2">
                <p className="font-medium">Fonctionnalités IA</p>
                <label className="flex items-center justify-between gap-2">
                  <span>Classification emails</span>
                  <Switch checked={aiClassify} onCheckedChange={setAiClassify} />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span>Résumés emails</span>
                  <Switch checked={aiSummary} onCheckedChange={setAiSummary} />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span>Suggestions de tâches</span>
                  <Switch checked={aiTaskSuggest} onCheckedChange={setAiTaskSuggest} />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span>Réponses semi-automatiques</span>
                  <Switch checked={aiAutoReply} onCheckedChange={setAiAutoReply} />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span>Archivage newsletters</span>
                  <Switch checked={aiNewsletter} onCheckedChange={setAiNewsletter} />
                </label>
                <label className="flex items-center justify-between gap-2 opacity-90">
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" /> Détection HDS
                    <Badge variant="outline" className="ml-1">🔒 obligatoire</Badge>
                  </span>
                  <Switch checked disabled />
                </label>
              </div>

              <div className="space-y-1.5">
                <Label>Niveau de sensibilité HDS</Label>
                <Select value={hdsLevel} onValueChange={(v) => setHdsLevel(v as typeof hdsLevel)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strict">Stricte</SelectItem>
                    <SelectItem value="normal">Normale</SelectItem>
                    <SelectItem value="permissive">Permissive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {step === 7 && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">Vous êtes prêt ! Acceptez nos conditions pour terminer.</p>
              <label className="flex items-start gap-2">
                <Checkbox checked={acceptRgpd} onCheckedChange={(v) => setAcceptRgpd(!!v)} />
                <span>
                  J'accepte la politique de confidentialité et le traitement de mes données conformément au RGPD.
                  Mes données sont stockées de manière sécurisée et je peux les exporter ou les supprimer à tout moment.
                </span>
              </label>
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1 || busy}>
              Précédent
            </Button>
            <div className="flex gap-2">
              {canSkip && step < STEPS.length && (
                <Button variant="ghost" onClick={() => setStep((s) => s + 1)} disabled={busy}>
                  Passer cette étape
                </Button>
              )}
              {!isLast ? (
                <Button onClick={() => setStep((s) => s + 1)} disabled={busy}>Suivant</Button>
              ) : (
                <Button onClick={finish} disabled={busy || !acceptRgpd}>Terminer</Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
