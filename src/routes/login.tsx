import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
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
  const { user, refreshSession } = useAuth();
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
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Les mots de passe ne correspondent pas");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { display_name: name },
      },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Compte créé. Vérifiez vos emails pour confirmer.");
  };

  const oauth = async (provider: "google" | "apple") => {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin,
      });

      // Full-page redirect flow: the browser navigates away, nothing else to do.
      if (result.redirected) return;

      if (result.error) {
        toast.error(result.error.message ?? "Échec de connexion");
        return;
      }

      // Popup / message flow: the SDK has already called supabase.auth.setSession().
      // Re-validate and refresh local auth context.
      await refreshSession();
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        toast.error(error?.message ?? "Session non validée");
        return;
      }
      applyRememberPreference(remember);
      navigate({ to: "/dashboard", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de connexion");
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
          <div className="space-y-2 pb-4">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => oauth("google")}
              disabled={busy}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continuer avec Google
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => oauth("apple")}
              disabled={busy}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
              </svg>
              Continuer avec Apple
            </Button>
            <div className="relative py-2">
              <Separator />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                ou avec un email
              </span>
            </div>
          </div>
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
