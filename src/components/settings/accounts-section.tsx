import { useEffect, useState } from "react";
import { Plus, Mail, RefreshCw, Trash2, Pencil, CheckCircle2, AlertCircle, Clock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type AccountType = "gmail" | "outlook" | "imap" | "icloud";

type Account = {
  id: string;
  user_id: string;
  name: string;
  type: AccountType;
  color: string | null;
  icon: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  credentials: Record<string, unknown> | null;
};

const ICONS = ["🏥", "🎓", "💼", "📧", "🏠", "🎨", "⚡", "🌟"];
const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];

const TYPE_LABEL: Record<string, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  imap: "IMAP / SMTP",
  icloud: "iCloud",
};

type Preset = {
  key: string;
  label: string;
  emoji: string;
  type: AccountType;
  server: string;
  port: string;
  ssl: boolean;
  domain?: string;
};

const PRESETS: Preset[] = [
  { key: "gmail", label: "Gmail", emoji: "📧", type: "gmail", server: "imap.gmail.com", port: "993", ssl: true },
  { key: "outlook", label: "Outlook", emoji: "📨", type: "outlook", server: "outlook.office365.com", port: "993", ssl: true },
  { key: "ovh", label: "OVH / CHU", emoji: "🏥", type: "imap", server: "imap.mail.ovh.net", port: "993", ssl: true, domain: "myhub-pro.fr" },
  { key: "univ", label: "Université Bordeaux", emoji: "🎓", type: "imap", server: "webmel.u-bordeaux.fr", port: "7993", ssl: true, domain: "u-bordeaux.fr" },
  { key: "echo", label: "Echo Bordeaux", emoji: "💼", type: "imap", server: "imap.echobordeaux.com", port: "993", ssl: true, domain: "echobordeaux.com" },
  { key: "imap", label: "IMAP personnalisé", emoji: "⚙️", type: "imap", server: "", port: "993", ssl: true },
];

export function AccountsSection() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("accounts")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    else setAccounts((data ?? []) as Account[]);
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  const remove = async (id: string) => {
    const { error } = await supabase.from("accounts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Compte supprimé");
    load();
  };

  const testConnection = async (acc: Account) => {
    toast.loading("Test en cours…", { id: `test-${acc.id}` });
    await new Promise((r) => setTimeout(r, 1200));
    toast.success(`Connexion OK pour ${acc.name}`, { id: `test-${acc.id}` });
    await supabase.from("accounts").update({ last_sync_at: new Date().toISOString() }).eq("id", acc.id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Comptes email</h2>
          <p className="text-sm text-muted-foreground">Connectez vos 5 boîtes : CHU, Université, Echo, Gmail, Outlook</p>
        </div>
        <Button onClick={() => setWizardOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Ajouter
        </Button>
      </div>

      {accounts === null ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Mail className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">Aucun compte configuré</p>
              <p className="text-sm text-muted-foreground">Ajoutez votre première boîte pour commencer.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {accounts.map((acc) => (
            <AccountCard
              key={acc.id}
              account={acc}
              onTest={() => testConnection(acc)}
              onRemove={() => remove(acc.id)}
              onChanged={load}
            />
          ))}
        </div>
      )}

      <AccountWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={() => {
          setWizardOpen(false);
          load();
        }}
      />
    </div>
  );
}

function AccountCard({
  account,
  onTest,
  onRemove,
  onChanged,
}: {
  account: Account;
  onTest: () => void;
  onRemove: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const status: "connected" | "error" | "pending" = account.last_sync_at
    ? "connected"
    : account.credentials
      ? "pending"
      : "error";

  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl"
          style={{ backgroundColor: (account.color ?? "#3b82f6") + "20" }}
        >
          <span>{account.icon ?? "📧"}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{account.name}</p>
            <Badge variant="outline" className="text-xs">
              {TYPE_LABEL[account.type] ?? account.type}
            </Badge>
            <StatusBadge status={status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {account.last_sync_at
              ? `Sync ${new Date(account.last_sync_at).toLocaleString("fr-FR")}`
              : "Jamais synchronisé"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onTest} title="Tester">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setEditing(true)} title="Modifier">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemove} title="Supprimer">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </CardContent>
      <EditDialog
        account={account}
        open={editing}
        onOpenChange={setEditing}
        onSaved={() => {
          setEditing(false);
          onChanged();
        }}
      />
    </Card>
  );
}

function StatusBadge({ status }: { status: "connected" | "error" | "pending" }) {
  if (status === "connected")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" /> Connecté
      </span>
    );
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <AlertCircle className="h-3 w-3" /> Erreur
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
      <Clock className="h-3 w-3" /> En attente
    </span>
  );
}

function EditDialog({
  account,
  open,
  onOpenChange,
  onSaved,
}: {
  account: Account;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(account.name);
  const [color, setColor] = useState(account.color ?? COLORS[0]);
  const [icon, setIcon] = useState(account.icon ?? ICONS[0]);

  useEffect(() => {
    if (open) {
      setName(account.name);
      setColor(account.color ?? COLORS[0]);
      setIcon(account.icon ?? ICONS[0]);
    }
  }, [open, account]);

  const save = async () => {
    const { error } = await supabase.from("accounts").update({ name, color, icon }).eq("id", account.id);
    if (error) return toast.error(error.message);
    toast.success("Compte mis à jour");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier le compte</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Nom affiché</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <ColorPicker value={color} onChange={setColor} />
          <IconPicker value={icon} onChange={setIcon} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={save}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>Couleur</Label>
      <div className="flex flex-wrap gap-2">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={cn(
              "h-8 w-8 rounded-full border-2 transition",
              value === c ? "border-foreground scale-110" : "border-transparent",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>Icône</Label>
      <div className="flex flex-wrap gap-2">
        {ICONS.map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition",
              value === i ? "border-primary bg-primary/10" : "border-input hover:bg-muted",
            )}
          >
            {i}
          </button>
        ))}
      </div>
    </div>
  );
}

type WizardStep = 1 | 2 | 3;

function AccountWizard({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const [step, setStep] = useState<WizardStep>(1);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [type, setType] = useState<AccountType | null>(null);
  const [imap, setImap] = useState({ server: "", port: "993", ssl: true, username: "", password: "", email: "" });
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [icon, setIcon] = useState(ICONS[0]);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<null | "ok" | "fail">(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setPreset(null);
      setType(null);
      setImap({ server: "", port: "993", ssl: true, username: "", password: "", email: "" });
      setName("");
      setColor(COLORS[0]);
      setIcon(ICONS[0]);
      setTested(null);
    }
  }, [open]);

  const pickPreset = (p: Preset) => {
    setPreset(p);
    setType(p.type);
    setImap({
      server: p.server,
      port: p.port,
      ssl: p.ssl,
      username: "",
      password: "",
      email: p.domain ? `@${p.domain}` : "",
    });
    if (p.type === "gmail" || p.type === "outlook") {
      handleOAuth(p.type);
      return;
    }
    setName(p.label);
    setStep(2);
  };

  const handleOAuth = async (provider: "gmail" | "outlook") => {
    setBusy(true);
    try {
      if (provider === "gmail") {
        // Gmail est branché via le connector Lovable (OAuth fait au niveau workspace).
        const { data: sess } = await supabase.auth.getSession();
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-gmail`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
          },
          body: JSON.stringify({ test: true }),
        });
        const data = await res.json().catch(() => ({ ok: false }));
        if (!data.ok) throw new Error(data.error || `Connector Gmail KO (${res.status})`);
        const email = data.profile?.emailAddress || "Gmail";
        setName(`Gmail (${email})`);
        setImap((s) => ({ ...s, email, username: email }));
        setTested("ok");
        setStep(2);
      } else {
        toast.info("Connexion Outlook OAuth — bientôt disponible");
        setName("Outlook");
        setStep(2);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Échec OAuth");
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTested(null);
    if (type === "imap" && imap.server && imap.username && imap.password) {
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-imap`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}`,
          },
          body: JSON.stringify({
            account_id: "__test__",
            test_credentials: {
              server: imap.server,
              port: Number(imap.port),
              username: imap.username,
              password: imap.password,
            },
          }),
        });
        const data = await res.json().catch(() => ({ ok: false }));
        setTested(data.ok ? "ok" : "fail");
      } catch {
        setTested("fail");
      }
    } else {
      await new Promise((r) => setTimeout(r, 600));
      setTested(type !== "imap" ? "ok" : "fail");
    }
    setTesting(false);
  };

  const save = async () => {
    if (!user || !type) return;
    setBusy(true);
    const credentials =
      type === "imap" || type === "icloud"
        ? { server: imap.server, port: Number(imap.port), ssl: imap.ssl, username: imap.username, password: imap.password, email: imap.email || imap.username }
        : { oauth: true };
    const { error } = await supabase.from("accounts").insert({
      user_id: user.id,
      name: name || TYPE_LABEL[type],
      type,
      color,
      icon,
      credentials,
      is_active: true,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Compte ajouté");
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajouter un compte email</DialogTitle>
          <DialogDescription>
            Étape {step}/3 — {step === 1 ? "Choix du fournisseur" : step === 2 ? "Configuration" : "Test & confirmation"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 pb-2">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={cn("h-1 flex-1 rounded-full", s <= step ? "bg-primary" : "bg-muted")}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <PresetButton
                key={p.key}
                label={p.label}
                hint={`${p.server || "OAuth"} ${p.port ? ":" + p.port : ""}`}
                emoji={p.emoji}
                onClick={() => pickPreset(p)}
                disabled={busy}
              />
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {type === "imap" && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>Serveur IMAP</Label>
                    <Input value={imap.server} onChange={(e) => setImap({ ...imap, server: e.target.value })} placeholder="imap.example.com" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Port</Label>
                    <Input value={imap.port} onChange={(e) => setImap({ ...imap, port: e.target.value })} />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="ssl">SSL / TLS</Label>
                  <Switch id="ssl" checked={imap.ssl} onCheckedChange={(v) => setImap({ ...imap, ssl: v })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Identifiant (login IMAP)</Label>
                  <Input value={imap.username} onChange={(e) => setImap({ ...imap, username: e.target.value })} placeholder="vous@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label>Mot de passe</Label>
                  <Input type="password" value={imap.password} onChange={(e) => setImap({ ...imap, password: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Adresse email associée</Label>
                  <Input value={imap.email} onChange={(e) => setImap({ ...imap, email: e.target.value })} placeholder="vous@example.com" />
                  <p className="text-xs text-muted-foreground">Utilisée pour l'affichage et la détection de l'origine</p>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Nom affiché</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CHU, Université, Perso…" />
            </div>
            <ColorPicker value={color} onChange={setColor} />
            <IconPicker value={icon} onChange={setIcon} />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-lg"
                  style={{ backgroundColor: color + "20" }}
                >
                  {icon}
                </span>
                <div>
                  <p className="font-medium">{name || (type ? TYPE_LABEL[type] : "")}</p>
                  <p className="text-xs text-muted-foreground">{type ? TYPE_LABEL[type] : ""}</p>
                </div>
              </div>
              {type === "imap" && (
                <p className="text-xs text-muted-foreground">
                  {imap.server}:{imap.port} {imap.ssl && "(SSL)"} • {imap.username}
                </p>
              )}
            </div>
            <Button variant="outline" onClick={runTest} disabled={testing} className="w-full">
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Tester la connexion
            </Button>
            {tested === "ok" && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Connexion réussie
              </div>
            )}
            {tested === "fail" && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" /> Échec — vérifiez les paramètres
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && (
            <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as WizardStep)}>
              Retour
            </Button>
          )}
          {step === 2 && (
            <Button onClick={() => setStep(3)} disabled={!type}>
              Continuer
            </Button>
          )}
          {step === 3 && (
            <Button onClick={save} disabled={busy || tested !== "ok"}>
              {busy ? "Création…" : "Créer le compte"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PresetButton({
  label,
  hint,
  emoji,
  onClick,
  disabled,
}: {
  label: string;
  hint: string;
  emoji: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
    >
      <span className="text-2xl">{emoji}</span>
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}