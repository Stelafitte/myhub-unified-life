import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

type CheckRow = { label: string; ok: boolean; detail: string; targetStep: number };

export function Step7Recap({
  firstName,
  onGoToStep,
  onLaunch,
  launching,
  hasEmailAccount,
}: {
  firstName: string;
  onGoToStep: (n: number) => void;
  onLaunch: () => void;
  launching: boolean;
  hasEmailAccount: boolean;
}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<CheckRow[]>([]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const [accountsRes, calRes, contactsRes, settingsRes] = await Promise.all([
        supabase.from("accounts").select("id, type, name"),
        supabase.from("google_calendar_connections").select("id"),
        supabase.from("contacts").select("id", { count: "exact", head: true }),
        supabase
          .from("meeting_settings")
          .select("onenote_enabled")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

      const accounts = (accountsRes.data ?? []) as { type: string }[];
      const emailAccounts = accounts.filter((a) =>
        ["gmail", "outlook", "imap", "icloud"].includes(a.type),
      ).length;
      const contactSources = accounts.filter((a) => a.type === "contacts").length;
      const calConns = (calRes.data ?? []).length;
      const contactCount = contactsRes.count ?? 0;

      const step6 = readJson("onboarding.step6");
      const step5 = readJson("onboarding.step5");
      const integrationsActive =
        (settingsRes.data?.onenote_enabled ? 1 : 0) +
        (step5?.msTodoEnabled ? 1 : 0) +
        (step5?.appleRemindersTested === "ok" ? 1 : 0) +
        (step5?.zoomConnected ? 1 : 0);

      setChecks([
        {
          label: "Comptes email",
          ok: emailAccounts > 0,
          detail: emailAccounts > 0 ? `${emailAccounts} compte(s) configuré(s)` : "Aucun compte configuré",
          targetStep: 2,
        },
        {
          label: "Agendas",
          ok: calConns > 0,
          detail: calConns > 0 ? `${calConns} agenda(s) connecté(s)` : "Aucun agenda",
          targetStep: 3,
        },
        {
          label: "Contacts",
          ok: contactCount > 0 || contactSources > 0,
          detail:
            contactCount > 0
              ? `${contactCount} contact(s) synchronisé(s)`
              : contactSources > 0
                ? `${contactSources} source(s) configurée(s)`
                : "Aucun contact",
          targetStep: 4,
        },
        {
          label: "Intégrations",
          ok: integrationsActive > 0,
          detail: integrationsActive > 0 ? `${integrationsActive} intégration(s) active(s)` : "Aucune",
          targetStep: 5,
        },
        {
          label: "Intelligence artificielle",
          ok: !!step6,
          detail: step6?.useOwnKey ? "Clé personnelle configurée" : "IA incluse (par défaut)",
          targetStep: 6,
        },
      ]);
      setLoading(false);
    })();
  }, [user]);

  const pendingCount = checks.filter((c) => !c.ok).length;

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          {firstName ? `Tout est prêt, ${firstName} !` : "Tout est prêt !"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Récapitulatif de votre configuration. Vous pourrez ajuster chaque section dans les Paramètres.
        </p>
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {checks.map((c) => (
            <div key={c.label} className="flex items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                {c.ok ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                )}
                <div>
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                </div>
              </div>
              {!c.ok && (
                <Button size="sm" variant="ghost" onClick={() => onGoToStep(c.targetStep)}>
                  Configurer
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {pendingCount > 0 && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          Vous avez {pendingCount} étape(s) passée(s) — vous pouvez les configurer maintenant ou plus tard depuis Paramètres.
        </p>
      )}

      <div className="flex flex-col items-stretch gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-end">
        <Button
          onClick={onLaunch}
          disabled={launching || !hasEmailAccount}
          size="lg"
          className="sm:min-w-56"
        >
          {launching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Rocket className="mr-2 h-4 w-4" />
          )}
          {launching ? "Lancement…" : "🚀 Lancer MyHub Pro"}
        </Button>
      </div>

      {!hasEmailAccount && (
        <p className="text-center text-xs text-destructive">
          Au moins 1 compte email doit être configuré (étape 2) pour terminer.
        </p>
      )}
    </div>
  );
}

function readJson(key: string): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
