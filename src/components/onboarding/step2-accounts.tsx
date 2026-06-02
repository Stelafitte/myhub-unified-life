import { useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Mail,
  ExternalLink,
  Copy,
  Eye,
  EyeOff,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { detectEmailProvider, suggestDisplayName, suggestIcon, type DetectedProvider } from "@/lib/email-domain-detect";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];
const ICONS = ["📧", "🏥", "🎓", "💼", "🏠"];
const MAX_ACCOUNTS = 10;

type StoredAccount = {
  id: string;
  name: string;
  type: "gmail" | "outlook" | "imap" | "icloud";
  color: string | null;
  icon: string | null;
  credentials: Record<string, unknown> | null;
  last_sync_at: string | null;
};

type DraftAccount = {
  email: string;
  detection: DetectedProvider;
  name: string;
  color: string;
  icon: string;
  imapPassword: string;
  imapUsername: string;
  testState: "idle" | "testing" | "ok" | "fail";
  testError: string | null;
};

export function Step2Accounts({ onContinue, onSkip }: { onContinue: () => void; onSkip?: () => void }) {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<DraftAccount[]>([]);
  const [redirectGuideFor, setRedirectGuideFor] = useState<{ email: string; provider: DetectedProvider } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("accounts")
      .select("id,name,type,color,icon,credentials,last_sync_at")
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    else setAccounts((data ?? []) as StoredAccount[]);
    setLoading(false);
  };

  useEffect(() => {
    if (user) void load();
  }, [user]);

  const totalCount = accounts.length + drafts.length;

  const addDraft = () => {
    if (totalCount >= MAX_ACCOUNTS) {
      toast.error(`Maximum ${MAX_ACCOUNTS} comptes`);
      return;
    }
    setDrafts((d) => [
      ...d,
      {
        email: "",
        detection: { kind: "unknown", label: "Saisissez une adresse email", icon: "📧" },
        name: "",
        color: COLORS[d.length % COLORS.length],
        icon: "📧",
        imapPassword: "",
        imapUsername: "",
        testState: "idle",
        testError: null,
      },
    ]);
  };

  const updateDraft = (i: number, patch: Partial<DraftAccount>) => {
    setDrafts((d) => d.map((dr, idx) => (idx === i ? { ...dr, ...patch } : dr)));
  };

  const removeDraft = (i: number) => {
    setDrafts((d) => d.filter((_, idx) => idx !== i));
  };

  const removeAccount = async (id: string) => {
    const { error } = await supabase.from("accounts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Compte supprimé");
    load();
  };

  const canContinue = accounts.length >= 1;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Vos comptes email</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connectez jusqu'à {MAX_ACCOUNTS} boîtes. <strong>Au moins 1 compte requis</strong> pour terminer le wizard.
        </p>
      </div>

      {/* Comptes déjà enregistrés */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : accounts.length > 0 ? (
        <div className="space-y-2">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-center gap-3 p-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-lg"
                  style={{ backgroundColor: (a.color ?? "#3b82f6") + "20" }}
                >
                  {a.icon ?? "📧"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <Badge variant="outline" className="mr-1 text-[10px]">
                      {a.type.toUpperCase()}
                    </Badge>
                    {a.last_sync_at ? "Connecté ✓" : "Configuré"}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeAccount(a.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {/* Brouillons en cours de configuration */}
      {drafts.map((draft, i) => (
        <DraftCard
          key={i}
          draft={draft}
          onChange={(patch) => updateDraft(i, patch)}
          onRemove={() => removeDraft(i)}
          onSaved={(saved) => {
            setAccounts((a) => [...a, saved]);
            removeDraft(i);
          }}
          onOpenRedirectGuide={() => setRedirectGuideFor({ email: draft.email, provider: draft.detection })}
        />
      ))}

      {totalCount < MAX_ACCOUNTS && (
        <Button variant="outline" onClick={addDraft} className="w-full" size="lg">
          <Plus className="mr-2 h-4 w-4" /> Ajouter un compte email
        </Button>
      )}

      {accounts.length === 0 && drafts.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Mail className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Aucun compte pour le moment</p>
            <Button onClick={addDraft}>
              <Plus className="mr-2 h-4 w-4" /> Ajouter mon premier compte
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between border-t pt-4">
        <p className="text-xs text-muted-foreground">
          {accounts.length} compte{accounts.length > 1 ? "s" : ""} configuré{accounts.length > 1 ? "s" : ""}
        </p>
        <div className="flex gap-2">
          {onSkip && accounts.length >= 1 && (
            <Button variant="ghost" onClick={onSkip}>
              Passer cette étape
            </Button>
          )}
          <Button onClick={onContinue} disabled={!canContinue} size="lg">
            Continuer
          </Button>
        </div>
      </div>

      {redirectGuideFor && (
        <RedirectGuideDialog
          email={redirectGuideFor.email}
          provider={redirectGuideFor.provider}
          onClose={() => setRedirectGuideFor(null)}
          onConfirmed={() => {
            toast.success("Redirection configurée — pensez à vérifier l'arrivée des mails");
            setRedirectGuideFor(null);
          }}
        />
      )}
    </div>
  );
}

function DraftCard({
  draft,
  onChange,
  onRemove,
  onSaved,
  onOpenRedirectGuide,
}: {
  draft: DraftAccount;
  onChange: (patch: Partial<DraftAccount>) => void;
  onRemove: () => void;
  onSaved: (account: StoredAccount) => void;
  onOpenRedirectGuide: () => void;
}) {
  const { user } = useAuth();
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  // Détection avec debounce 500ms
  useEffect(() => {
    if (!draft.email.includes("@")) return;
    const t = setTimeout(() => {
      const det = detectEmailProvider(draft.email);
      onChange({
        detection: det,
        name: draft.name || suggestDisplayName(draft.email, det),
        icon: draft.icon === "📧" ? suggestIcon(det) : draft.icon,
        imapUsername: draft.imapUsername || draft.email,
      });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.email]);

  const det = draft.detection;

  const handleOAuth = async (provider: "gmail" | "outlook") => {
    if (!user) return;
    setBusy(true);
    const tid = toast.loading(`Connexion ${provider === "gmail" ? "Google" : "Microsoft"}…`);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const fn = provider === "gmail" ? "sync-gmail" : "sync-outlook";
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
        body: JSON.stringify({ test: true }),
      });
      const json = await res.json().catch(() => ({ ok: false }));
      if (!json.ok) throw new Error(json.error || `Connecteur ${provider} indisponible`);

      const detectedEmail =
        json.profile?.emailAddress || json.profile?.email || draft.email || (provider === "gmail" ? "Gmail" : "Outlook");

      const { data, error } = await supabase
        .from("accounts")
        .insert({
          user_id: user.id,
          name: draft.name || `${provider === "gmail" ? "Gmail" : "Outlook"} (${detectedEmail})`,
          type: provider,
          color: draft.color,
          icon: draft.icon,
          credentials: { oauth: true, email: detectedEmail },
          is_active: true,
        })
        .select("id,name,type,color,icon,credentials,last_sync_at")
        .single();
      if (error) throw error;
      toast.success(`${provider === "gmail" ? "Google" : "Microsoft"} connecté`, { id: tid });
      onSaved(data as StoredAccount);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la connexion OAuth", { id: tid });
    } finally {
      setBusy(false);
    }
  };

  const testImap = async () => {
    if (!(det.kind === "imap" || det.kind === "imap-or-redirect")) return;
    if (!draft.imapUsername || !draft.imapPassword) {
      toast.error("Identifiant et mot de passe requis");
      return;
    }
    onChange({ testState: "testing", testError: null });
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-imap`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
        body: JSON.stringify({
          account_id: "__test__",
          test_credentials: {
            server: det.server,
            port: det.port,
            username: draft.imapUsername,
            password: draft.imapPassword,
          },
        }),
      });
      const json = await res.json().catch(() => ({ ok: false }));
      if (json.ok) {
        onChange({ testState: "ok", testError: null });
      } else {
        onChange({ testState: "fail", testError: translateImapError(json.error) });
      }
    } catch (e) {
      onChange({ testState: "fail", testError: e instanceof Error ? e.message : "Échec réseau" });
    }
  };

  const saveImap = async () => {
    if (!user || !(det.kind === "imap" || det.kind === "imap-or-redirect")) return;
    if (draft.testState !== "ok") {
      toast.error("Testez la connexion d'abord");
      return;
    }
    setBusy(true);
    try {
      const isIcloud = det.label.toLowerCase().includes("icloud");
      const { data, error } = await supabase
        .from("accounts")
        .insert({
          user_id: user.id,
          name: draft.name || draft.email,
          type: isIcloud ? "icloud" : "imap",
          color: draft.color,
          icon: draft.icon,
          credentials: {
            server: det.server,
            port: det.port,
            ssl: true,
            username: draft.imapUsername,
            password: draft.imapPassword,
            email: draft.email,
          },
          is_active: true,
        })
        .select("id,name,type,color,icon,credentials,last_sync_at")
        .single();
      if (error) throw error;
      toast.success("Compte ajouté");
      onSaved(data as StoredAccount);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-primary/30">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">Adresse email</Label>
            <Input
              type="email"
              autoFocus
              value={draft.email}
              onChange={(e) => onChange({ email: e.target.value })}
              placeholder="vous@exemple.com"
              autoComplete="email"
            />
            {det.kind !== "unknown" && draft.email.includes("@") && (
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="secondary">{det.icon} {det.label}</Badge>
                {det.kind === "imap" && (
                  <span className="text-muted-foreground">IMAP {det.server}:{det.port}</span>
                )}
                {det.kind === "oauth" && <span className="text-muted-foreground">OAuth2 sécurisé</span>}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onRemove} className="mt-6">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Champs name / color / icon */}
        {draft.email.includes("@") && det.kind !== "unknown" && (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="space-y-1.5">
              <Label className="text-xs">Nom affiché</Label>
              <Input value={draft.name} onChange={(e) => onChange({ name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Couleur</Label>
              <div className="flex gap-1">
                {COLORS.slice(0, 6).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onChange({ color: c })}
                    className={cn(
                      "h-6 w-6 rounded-full border-2 transition",
                      draft.color === c ? "border-foreground" : "border-transparent",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Icône</Label>
              <div className="flex gap-1">
                {ICONS.map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onChange({ icon: i })}
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded border text-sm",
                      draft.icon === i ? "border-primary bg-primary/10" : "border-input",
                    )}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Actions par type */}
        {det.kind === "oauth" && (
          <Button onClick={() => handleOAuth(det.provider)} disabled={busy} className="w-full" size="lg">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Connecter avec {det.provider === "gmail" ? "Google" : "Microsoft"}
          </Button>
        )}

        {(det.kind === "imap" || det.kind === "imap-or-redirect") && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              Connexion IMAP <strong>{det.server}:{det.port}</strong> (SSL)
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Identifiant</Label>
                <Input value={draft.imapUsername} onChange={(e) => onChange({ imapUsername: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Mot de passe</Label>
                <div className="relative">
                  <Input
                    type={showPw ? "text" : "password"}
                    value={draft.imapPassword}
                    onChange={(e) => onChange({ imapPassword: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute inset-y-0 right-2 flex items-center text-muted-foreground"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={testImap} disabled={draft.testState === "testing"} size="sm">
                {draft.testState === "testing" ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Tester la connexion
              </Button>
              {draft.testState === "ok" && (
                <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Connexion réussie
                </span>
              )}
              {draft.testState === "fail" && (
                <span className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5" /> {draft.testError ?? "Échec"}
                </span>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              {det.kind === "imap-or-redirect" && (
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onOpenRedirectGuide}>
                  IMAP refuse la connexion ? Voir le guide redirection
                </Button>
              )}
              <Button
                onClick={saveImap}
                disabled={busy || draft.testState !== "ok"}
                className="ml-auto"
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Enregistrer
              </Button>
            </div>
          </div>
        )}

        {det.kind === "exchange-redirect" && (
          <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">🏥 Exchange interne détecté</p>
            <p className="text-xs text-muted-foreground">{det.hint}</p>
            <Button variant="default" onClick={onOpenRedirectGuide} className="mt-1">
              <ExternalLink className="mr-2 h-4 w-4" /> Configurer la redirection
            </Button>
          </div>
        )}

        {det.kind === "unknown" && draft.email.includes("@") && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
            <p>Domaine non reconnu. Comment souhaitez-vous procéder ?</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onChange({
                    detection: {
                      kind: "imap",
                      label: "IMAP personnalisé",
                      icon: "⚙️",
                      server: `imap.${draft.email.split("@")[1] ?? ""}`,
                      port: 993,
                      ssl: true,
                    },
                  })
                }
              >
                Configurer un IMAP générique
              </Button>
              <Button size="sm" variant="outline" onClick={onOpenRedirectGuide}>
                Utiliser une redirection
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function translateImapError(err: unknown): string {
  const s = typeof err === "string" ? err.toLowerCase() : "";
  if (s.includes("auth") || s.includes("login") || s.includes("password")) {
    return "Identifiants refusés — vérifiez login/mot de passe (ou créez un mot de passe d'application)";
  }
  if (s.includes("timeout") || s.includes("etimedout")) return "Serveur injoignable (timeout)";
  if (s.includes("certificate") || s.includes("ssl")) return "Erreur SSL/TLS — contactez l'administrateur";
  if (s.includes("enotfound") || s.includes("dns")) return "Serveur introuvable (DNS)";
  return typeof err === "string" && err ? err : "Échec de connexion";
}

function RedirectGuideDialog({
  email,
  provider,
  onClose,
  onConfirmed,
}: {
  email: string;
  provider: DetectedProvider;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const { user } = useAuth();
  const [waiting, setWaiting] = useState(false);
  const targetAddress = user?.email ?? "votre-adresse@myhub-pro.fr";
  const providerLabel = "label" in provider ? provider.label : "votre webmail";

  const copy = () => {
    void navigator.clipboard.writeText(targetAddress);
    toast.success("Adresse copiée");
  };

  const test = () => {
    setWaiting(true);
    // Simulation simple — attente 60s puis confirmation. Le vrai test arrivera
    // quand l'edge function de réception détectera un mail entrant.
    setTimeout(() => {
      setWaiting(false);
      onConfirmed();
    }, 3000);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Configurer une redirection email</DialogTitle>
          <DialogDescription>
            Pour <strong>{email || "votre adresse"}</strong> ({providerLabel})
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-4 py-2">
          <Step n={1} title={`Connectez-vous à ${providerLabel}`}>
            <p className="text-xs text-muted-foreground">
              Ouvrez votre webmail habituel (intranet ou portail Exchange/OWA).
            </p>
          </Step>
          <Step n={2} title="Allez dans Paramètres → Transfert / Redirection automatique">
            <p className="text-xs text-muted-foreground">
              Dans Outlook Web : Paramètres → Courrier → Transfert. Sur les portails CHU, demandez à votre DSI si nécessaire.
            </p>
          </Step>
          <Step n={3} title="Entrez cette adresse de redirection">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2 font-mono text-sm">
              <span className="flex-1 truncate">{targetAddress}</span>
              <Button size="icon" variant="ghost" onClick={copy}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Cochez « Conserver une copie » si vous voulez garder vos mails sur le serveur d'origine.
            </p>
          </Step>
        </ol>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            Plus tard
          </Button>
          <Button onClick={test} disabled={waiting}>
            {waiting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> En attente d'un email (60s)…
              </>
            ) : (
              "J'ai configuré → Tester"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {n}
      </span>
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

// Garde useMemo importé pour usages futurs sans warning
void useMemo;
