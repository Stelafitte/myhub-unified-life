import { useEffect, useState } from "react";
import { Database, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const parts = host.split(".");
    const sub = parts[0] ?? "";
    const masked = sub.length > 5 ? `${sub.slice(0, 5)}…` : sub;
    return `${u.protocol}//${masked}.${parts.slice(1).join(".")}`;
  } catch {
    return url;
  }
}

const PROJECT_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://ttonkqwfaaqdgpfiwomp.supabase.co";

export function BackendSection() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [tablesCount, setTablesCount] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);

  async function runTest() {
    setTesting(true);
    const t0 = performance.now();
    try {
      const { error } = await supabase.from("profiles").select("id", { count: "exact", head: true }).limit(1);
      const ms = Math.round(performance.now() - t0);
      if (error) throw error;
      setConnected(true);
      setLatency(ms);
      setLastCheck(new Date());
    } catch {
      setConnected(false);
      setLatency(null);
      setLastCheck(new Date());
    } finally {
      setTesting(false);
    }
  }

  async function loadTablesCount() {
    // Heuristic: count tables we know exist via a lightweight RPC-less probe.
    // information_schema is not exposed via PostgREST, so we use a static list
    // derived from the generated types as a best-effort indicator.
    try {
      const mod = await import("@/integrations/supabase/types");
      const types = mod as unknown as { Database?: { public?: { Tables?: Record<string, unknown> } } };
      const tables = types.Database?.public?.Tables;
      if (tables) setTablesCount(Object.keys(tables).length);
    } catch {
      setTablesCount(null);
    }
  }

  useEffect(() => {
    runTest();
    loadTablesCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-lg border bg-card p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Database className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">Backend</h3>
          <p className="text-sm text-muted-foreground">Informations de connexion (lecture seule)</p>
        </div>
        {connected === null ? (
          <Badge variant="secondary">…</Badge>
        ) : connected ? (
          <Badge className="bg-green-600 hover:bg-green-600 text-white gap-1">
            <CheckCircle2 className="h-3 w-3" /> Connecté
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" /> Hors ligne
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">URL du projet</div>
          <div className="font-mono text-sm">{maskUrl(PROJECT_URL)}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Tables actives</div>
          <div className="font-mono text-sm">{tablesCount ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Dernière vérification</div>
          <div className="font-mono text-sm">
            {lastCheck ? lastCheck.toLocaleString("fr-FR") : "—"}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Temps de réponse</div>
          <div className="font-mono text-sm">{latency !== null ? `${latency} ms` : "—"}</div>
        </div>
      </div>

      <div>
        <Button onClick={runTest} disabled={testing} variant="outline" size="sm">
          {testing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Test en cours…
            </>
          ) : (
            "Tester la connexion"
          )}
        </Button>
      </div>
    </div>
  );
}
