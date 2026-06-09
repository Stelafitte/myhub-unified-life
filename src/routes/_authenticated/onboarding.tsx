import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
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
import {
  Sparkles, User, Mail, Calendar, Plug, Brain, CheckCircle2,
  Eye, EyeOff, ShieldCheck, ExternalLink, Loader2, Rocket,
  Users, Map,
} from "lucide-react";
import { toast } from "sonner";
import { startGoogleCalendarOAuth, syncGoogleCalendarEvents } from "@/lib/api/google-calendar.functions";

const searchSchema = z.object({ force: z.coerce.boolean().optional() });

export const Route = createFileRoute("/_authenticated/onboarding")({
  validateSearch: searchSchema,
  component: OnboardingPage,
});

const STEPS = [
  { id: 1, title: "Bienvenue", icon: Sparkles },
  { id: 2, title: "Profil", icon: User },
  { id: 3, title: "Comptes email", icon: Mail },
  { id: 4, title: "Agendas & Contacts", icon: Calendar },
  { id: 5, title: "Intégrations", icon: Plug },
  { id: 6, title: "Collaboration", icon: Users },
  { id: 7, title: "Intelligence IA", icon: Brain },
  { id: 8, title: "Récapitulatif", icon: CheckCircle2 },
];

type AiProvider = "openai-gpt4o-mini" | "anthropic-haiku" | "anthropic-sonnet";
type DetectedProvider = "gmail" | "outlook" | "icloud" | "chu" | "imap" | null;

function detectProvider(email: string): { provider: DetectedProvider; label: string; hint: string } {
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) return { provider: null, label: "", hint: "" };
  const domain = e.split("@")[1] ?? "";
  if (/^(gmail|googlemail)\.com$/.test(domain))
    return { provider: "gmail", label: "Gmail", hint: "OAuth2 Google — sécurisé, recommandé" };
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain))
    return { provider: "outlook", label: "Outlook / Microsoft 365", hint: "OAuth2 Microsoft" };
  if (/^(icloud|me|mac)\.com$/.test(domain))
    return { provider: "icloud", label: "iCloud Mail", hint: "IMAP + mot de passe d'application Apple" };
  if (/^chu-[a-z]+\.fr$/.test(domain) || /\.aphp\.fr$/.test(domain) || /\.hcl\.fr$/.test(domain))
    return { provider: "chu", label: `Messagerie hospitalière (${domain})`, hint: "IMAP/SMTP — voir guide ci-dessous" };
  return { provider: "imap", label: `IMAP générique (${domain})`, hint: "Serveur IMAP/SMTP à configurer" };
}

function OnboardingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { force } = useSearch({ from: "/_authenticated/onboarding" });
  const startGCal = useServerFn(startGoogleCalendarOAuth);
  const runGCalSync = useServerFn(syncGoogleCalendarEvents);

  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);

  // Étape 3 — Email
  const [emailInput, setEmailInput] = useState("");
  const detected = useMemo(() => detectProvider(emailInput), [emailInput]);

  // Étape 4 — Agendas & Contacts
  const [syncDirection, setSyncDirection] = useState<"read" | "bidir">("bidir");
  const [gcalConnecting, setGcalConnecting] = useState(false);

  // Étape 5 — Intégrations
  const [intSlack, setIntSlack] = useState(false);
  const [intNotion, setIntNotion] = useState(false);
  const [intOneDrive, setIntOneDrive] = useState(true);
  const [intDrive, setIntDrive] = useState(false);

  // Étape 6 — Collaboration
  const [collabEnabled, setCollabEnabled] = useState(true);
  const [collabInviteEmail, setCollabInviteEmail] = useState("");

  // Étape 7 — IA
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
  const [aiPriority, setAiPriority] = useState(true);
  const [aiAutoTrash, setAiAutoTrash] = useState(true);
  const [hdsLevel, setHdsLevel] = useState<"strict" | "normal" | "permissive">("normal");

  // Étape 7 — RGPD + récap
  const [acceptRgpd, setAcceptRgpd] = useState(false);
  const [recap, setRecap] = useState<{
    accounts: number;
    gcalConnections: number;
    accountList: { name: string; type: string }[];
  } | null>(null);

  // Chargement initial profil
  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("first_name,last_name,onboarding_completed_at").eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        if (data?.onboarding_completed_at && !force) {
          navigate({ to: "/inbox", replace: true });
          return;
        }
        if (data?.first_name) setFirstName(data.first_name);
        if (data?.last_name) setLastName(data.last_name);
      });
  }, [user, navigate, force]);

  // Charger le récap quand on arrive à l'étape finale
  useEffect(() => {
    if (step !== 8 || !user) return;
    (async () => {
      const [{ data: accts }, { data: gcals }] = await Promise.all([
        supabase.from("accounts").select("name,type").eq("user_id", user.id).eq("is_active", true),
        supabase.from("google_calendar_connections").select("id").eq("user_id", user.id).eq("is_active", true),
      ]);
      setRecap({
        accounts: accts?.length ?? 0,
        gcalConnections: gcals?.length ?? 0,
        accountList: accts ?? [],
      });
    })();
  }, [step, user]);

  const testApiKey = async () => {
    setKeyStatus("testing");
    await new Promise((r) => setTimeout(r, 500));
    const valid = aiKey.trim().length >= 20 && /^(sk-|claude-|anthropic|sk_)/i.test(aiKey.trim());
    setKeyStatus(valid ? "ok" : "ko");
    if (valid) toast.success("Format de clé valide");
    else toast.error("Format de clé non reconnu");
  };

  const connectGoogleCalendar = async () => {
    setGcalConnecting(true);
    try {
      const { authorizationUrl } = await startGCal({ data: { label: "Google Calendar" } });
      window.location.href = authorizationUrl;
    } catch (e) {
      setGcalConnecting(false);
      toast.error(e instanceof Error ? e.message : "Connexion impossible");
    }
  };

  const finish = async () => {
    if (!user) return;
    setBusy(true);
    try {
      // 1. Sauver profil + préférences IA (les toggles IA vivent en localStorage pour l'instant)
      localStorage.setItem("myhub.ai.prefs", JSON.stringify({
        useOwnKey, aiProvider, aiClassify, aiSummary, aiTaskSuggest,
        aiAutoReply, aiNewsletter, aiPriority, aiAutoTrash, hdsLevel,
      }));
      if (useOwnKey && aiKey.trim()) {
        localStorage.setItem("myhub.ai.userKey", aiKey.trim());
      }

      await supabase.from("profiles").update({
        first_name: firstName,
        last_name: lastName,
        display_name: `${firstName} ${lastName}`.trim() || null,
        onboarding_completed_at: new Date().toISOString(),
        hds_notice_accepted_at: new Date().toISOString(),
      }).eq("id", user.id);

      // 2. Première synchronisation best-effort (Google Calendar)
      if (recap && recap.gcalConnections > 0) {
        try {
          const res = await runGCalSync({ data: {} });
          toast.success(`Synchronisation initiale : ${res.synced} événement(s)`);
        } catch (e) {
          console.warn("Initial sync failed", e);
        }
      }

      toast.success("Bienvenue dans MyHub Pro ! 🚀");
      navigate({ to: "/inbox" });
    } finally {
      setBusy(false);
    }
  };

  const progress = (step / STEPS.length) * 100;
  const current = STEPS[step - 1];
  const Icon = current.icon;
  const isLast = step === STEPS.length;
  const canSkip = step === 3 || step === 4 || step === 5 || step === 6;

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
            {step === 6 && "Créez un espace de collaboration pour partager projets, fichiers et discussions."}
            {step === 7 && "Configurez l'intelligence artificielle de MyHub Pro."}
            {step === 8 && "Vérifiez votre configuration et lancez MyHub Pro."}
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
            <div className="space-y-4 text-sm">
              <div className="space-y-1.5">
                <Label>Votre adresse email professionnelle</Label>
                <Input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="prenom.nom@exemple.fr"
                  autoComplete="email"
                />
              </div>

              {detected.provider && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Détecté</Badge>
                    <span className="font-medium">{detected.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{detected.hint}</p>

                  {detected.provider === "chu" && (
                    <div className="mt-2 rounded border-l-2 border-primary/60 bg-background p-2 text-xs space-y-1">
                      <p className="font-medium">📋 Guide CHU / hôpital universitaire</p>
                      <p>• Serveur IMAP : généralement <code>imap.{emailInput.split("@")[1]}</code> (port 993, SSL)</p>
                      <p>• SMTP : <code>smtp.{emailInput.split("@")[1]}</code> (port 587, STARTTLS)</p>
                      <p>• Identifiant : votre matricule ou email complet</p>
                      <p>• Si MFA actif : demandez un mot de passe d'application à la DSI</p>
                    </div>
                  )}

                  <Button
                    size="sm"
                    onClick={() => navigate({ to: "/settings", search: { tab: "accounts" } as never })}
                    className="mt-1"
                  >
                    <ExternalLink className="mr-2 h-3 w-3" />
                    Configurer ce compte dans les Paramètres
                  </Button>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Vous pourrez ajouter d'autres comptes plus tard depuis <strong>Paramètres → Comptes</strong>.
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                <p className="font-medium">📅 Agendas</p>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="font-medium">Google Calendar</p>
                    <p className="text-xs text-muted-foreground">OAuth2 Google — connexion sécurisée</p>
                  </div>
                  <Button size="sm" onClick={connectGoogleCalendar} disabled={gcalConnecting}>
                    {gcalConnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Connecter"}
                  </Button>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3 opacity-70">
                  <div>
                    <p className="font-medium">Outlook Calendar <Badge variant="outline" className="ml-1">Bientôt</Badge></p>
                    <p className="text-xs text-muted-foreground">OAuth2 Microsoft</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => navigate({ to: "/settings", search: { tab: "calendars" } as never })}>
                    Paramètres
                  </Button>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3 opacity-70">
                  <div>
                    <p className="font-medium">iCloud Calendar <Badge variant="outline" className="ml-1">Bientôt</Badge></p>
                    <p className="text-xs text-muted-foreground">CalDAV — mot de passe d'application Apple</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => navigate({ to: "/settings", search: { tab: "calendars" } as never })}>
                    Paramètres
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="font-medium">👥 Contacts <Badge variant="outline" className="ml-1">Bientôt</Badge></p>
                <p className="text-xs text-muted-foreground">
                  Google / Outlook / iCloud Contacts seront configurables dans <strong>Paramètres → Contacts</strong>.
                </p>
                <Button size="sm" variant="outline" onClick={() => navigate({ to: "/settings", search: { tab: "contacts" } as never })}>
                  Ouvrir les Paramètres
                </Button>
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label>Direction de synchronisation par défaut</Label>
                <Select value={syncDirection} onValueChange={(v) => setSyncDirection(v as "read" | "bidir")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">Lecture seule</SelectItem>
                    <SelectItem value="bidir">Bidirectionnel</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">Connectez vos outils tiers favoris (optionnel) :</p>
              <label className="flex items-start gap-2 rounded-lg border p-3 bg-primary/5">
                <Checkbox checked={intOneDrive} onCheckedChange={(v) => setIntOneDrive(!!v)} className="mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">OneDrive / Microsoft Graph</span>
                    <Badge variant="secondary" className="text-[10px]">Recommandé</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Pièces jointes Inbox, fichiers partagés dans les espaces Collab.
                  </p>
                </div>
              </label>
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
              <p className="text-xs text-muted-foreground">
                Vous pourrez ajouter d'autres intégrations depuis <strong>Paramètres → Intégrations</strong>.
              </p>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border bg-primary/5 p-3 space-y-2">
                <p className="font-medium flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" /> Espaces de collaboration
                </p>
                <p className="text-xs text-muted-foreground">
                  Partagez un projet via un lien sécurisé : chat temps réel, fichiers OneDrive,
                  consultation de l'agenda et des tâches associées. Trois niveaux d'accès :
                </p>
                <ul className="text-xs space-y-1 pl-4">
                  <li>• <strong>Chat</strong> : obligatoire pour tous les invités</li>
                  <li>• <strong>Fichiers</strong> (OneDrive) : optionnel</li>
                  <li>• <strong>Reste</strong> (agenda, tâches) : consultatif</li>
                </ul>
              </div>

              <label className="flex items-center justify-between gap-2">
                <span className="text-sm">Activer la collaboration sur mes projets</span>
                <Switch checked={collabEnabled} onCheckedChange={setCollabEnabled} />
              </label>

              {collabEnabled && (
                <div className="space-y-2">
                  <Label className="text-xs">Pré-inviter un collaborateur (optionnel)</Label>
                  <Input
                    type="email"
                    value={collabInviteEmail}
                    onChange={(e) => setCollabInviteEmail(e.target.value)}
                    placeholder="collegue@exemple.fr"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Vous pourrez créer des espaces depuis n'importe quel projet via l'onglet <strong>Collab</strong>.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 7 && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium flex items-center gap-2">
                    <Badge variant="secondary">⚡ IA incluse</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Aucune configuration requise — l'IA Lovable est prête à l'emploi.
                  </p>
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
                <label className="flex items-center justify-between gap-2">
                  <span>Détection des priorités</span>
                  <Switch checked={aiPriority} onCheckedChange={setAiPriority} />
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
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <p className="font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  Votre configuration
                </p>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span>👤 Profil</span>
                    <span className="font-medium">{firstName || lastName ? `${firstName} ${lastName}`.trim() : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>📧 Comptes email connectés</span>
                    <span className="font-medium">{recap?.accounts ?? "…"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>📅 Google Calendar</span>
                    <span className="font-medium">
                      {recap === null ? "…" : recap.gcalConnections > 0 ? `${recap.gcalConnections} connecté(s)` : "Non connecté"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>🔄 Direction de sync</span>
                    <span className="font-medium">{syncDirection === "bidir" ? "Bidirectionnel" : "Lecture seule"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>🤖 IA</span>
                    <span className="font-medium">{useOwnKey ? "Clé personnelle" : "IA Lovable incluse"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>🔒 HDS</span>
                    <span className="font-medium capitalize">{hdsLevel}</span>
                  </div>
                </div>

                {recap && recap.accountList.length > 0 && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-1">Comptes :</p>
                    <ul className="text-xs space-y-0.5">
                      {recap.accountList.map((a, i) => (
                        <li key={i}>• {a.name} <span className="text-muted-foreground">({a.type})</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <label className="flex items-start gap-2">
                <Checkbox checked={acceptRgpd} onCheckedChange={(v) => setAcceptRgpd(!!v)} />
                <span className="text-xs">
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
                <Button onClick={finish} disabled={busy || !acceptRgpd} className="gap-2">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  Lancer MyHub Pro
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
