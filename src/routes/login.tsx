import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const REMEMBER_KEY = "myhubpro:remember-me";
const SUPABASE_AUTH_STORAGE_KEY = `sb-${import.meta.env.VITE_SUPABASE_PROJECT_ID}-auth-token`;

/** If "rester connecté" is off, move the persisted session from localStorage
 *  to sessionStorage so it disappears when the tab/browser is closed. */
function applyRememberPreference(remember: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (remember) {
      localStorage.setItem(REMEMBER_KEY, "1");
      const sess = sessionStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
      if (sess && !localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY)) {
        localStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, sess);
      }
      sessionStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
    } else {
      localStorage.setItem(REMEMBER_KEY, "0");
      const token = localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
      if (token) {
        sessionStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, token);
        localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
      }
    }
  } catch {
    /* storage may be blocked in private mode */
  }
}
function explainAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key) {
    return "Configuration backend manquante (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY vides). Reconnectez Lovable Cloud.";
  }
  if (/failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(raw)) {
    return `Impossible de joindre le serveur d'authentification (${url}). Causes possibles : projet backend en pause/inactif, coupure réseau, bloqueur (VPN/proxy/extension), ou URL non autorisée dans Auth → URL Configuration. Réessayez dans quelques secondes.`;
  }
  return raw || "Échec de connexion";
}

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function PasswordInput({
  id,
  value,
  onChange,
  minLength,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  minLength?: number;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Masquer le mot de passe" : "Afficher le mot de passe"}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function LoginPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(REMEMBER_KEY) !== "0";
  });

  useEffect(() => {
    if (user) navigate({ to: "/dashboard", replace: true });
  }, [user, navigate]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error(explainAuthError(error));
        return;
      }
      applyRememberPreference(remember);
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(explainAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const signInWithApple = async () => {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("apple", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(explainAuthError(result.error));
        return;
      }
      if (result.redirected) return;
      applyRememberPreference(remember);
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(explainAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Les mots de passe ne correspondent pas");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: { display_name: name },
        },
      });
      if (error) toast.error(explainAuthError(error));
      else toast.success("Compte créé. Vérifiez vos emails pour confirmer.");
    } catch (err) {
      toast.error(explainAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-muted px-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-xl">
            M
          </div>
          <CardTitle className="text-2xl">MyHub Pro</CardTitle>
          <CardDescription>Votre hub de productivité unifié</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Connexion</TabsTrigger>
              <TabsTrigger value="signup">Inscription</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={signIn} className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="si-email">Email</Label>
                  <Input
                    id="si-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="si-pw">Mot de passe</Label>
                  <PasswordInput
                    id="si-pw"
                    value={password}
                    onChange={setPassword}
                    autoComplete="current-password"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="remember-me"
                    checked={remember}
                    onCheckedChange={(v) => setRemember(v === true)}
                  />
                  <Label htmlFor="remember-me" className="cursor-pointer text-sm font-normal text-muted-foreground">
                    Rester connecté sur cet appareil
                  </Label>
                </div>
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? "Connexion…" : "Se connecter"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={signInWithApple}
                  className="w-full"
                >
                  <span aria-hidden="true" className="text-base leading-none"></span>
                  S’identifier avec Apple
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={signUp} className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="su-name">Nom</Label>
                  <Input id="su-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-email">Email</Label>
                  <Input
                    id="su-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-pw">Mot de passe</Label>
                  <PasswordInput
                    id="su-pw"
                    value={password}
                    onChange={setPassword}
                    minLength={6}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-pw2">Confirmer le mot de passe</Label>
                  <PasswordInput
                    id="su-pw2"
                    value={confirm}
                    onChange={setConfirm}
                    minLength={6}
                    autoComplete="new-password"
                  />
                  <p
                    className={cn(
                      "text-xs",
                      mismatch ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {mismatch ? "Les mots de passe ne correspondent pas" : "Minimum 6 caractères"}
                  </p>
                </div>
                <Button type="submit" disabled={busy || mismatch} className="w-full">
                  {busy ? "Création…" : "Créer un compte"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
