import { useEffect, useState } from "react";
import { Users, RefreshCw, Merge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type Source = {
  id: "google" | "icloud" | "outlook";
  label: string;
  icon: string;
  authKind: "OAuth2" | "CardDAV";
};

const SOURCES: Source[] = [
  { id: "google", label: "Google Contacts", icon: "🟢", authKind: "OAuth2" },
  { id: "icloud", label: "iCloud Contacts", icon: "☁️", authKind: "CardDAV" },
  { id: "outlook", label: "Outlook Contacts", icon: "🟦", authKind: "OAuth2" },
];

type Direction = "read" | "bidirectional";

type Duplicate = { key: string; ids: string[]; count: number };

export function ContactsSection() {
  const { user } = useAuth();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [directions, setDirections] = useState<Record<string, Direction>>({
    google: "bidirectional",
    icloud: "read",
    outlook: "bidirectional",
  });
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("myhub-contacts-dir");
    if (raw) {
      try {
        setDirections((d) => ({ ...d, ...JSON.parse(raw) }));
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("contacts")
      .select("sources")
      .eq("user_id", user.id)
      .then(({ data }) => {
        const tally: Record<string, number> = { google: 0, icloud: 0, outlook: 0 };
        for (const row of data ?? []) {
          for (const s of (row.sources as string[]) ?? []) {
            if (s in tally) tally[s] = (tally[s] ?? 0) + 1;
          }
        }
        setCounts(tally);
      });
  }, [user]);

  const updateDirection = (id: string, dir: Direction) => {
    const next = { ...directions, [id]: dir };
    setDirections(next);
    localStorage.setItem("myhub-contacts-dir", JSON.stringify(next));
  };

  const scanDuplicates = async () => {
    if (!user) return;
    setScanning(true);
    const { data } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, email")
      .eq("user_id", user.id);
    const groups = new Map<string, string[]>();
    for (const c of data ?? []) {
      const email = (c.email?.[0] ?? "").toLowerCase().trim();
      const key = email || `${(c.first_name ?? "").toLowerCase()}|${(c.last_name ?? "").toLowerCase()}`;
      if (!key.trim() || key === "|") continue;
      groups.set(key, [...(groups.get(key) ?? []), c.id]);
    }
    const dups = Array.from(groups.entries())
      .filter(([, ids]) => ids.length > 1)
      .map(([key, ids]) => ({ key, ids, count: ids.length }));
    setDuplicates(dups);
    setScanning(false);
    if (dups.length === 0) toast.success("Aucun doublon détecté");
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Contacts</h2>
        <p className="text-sm text-muted-foreground">Sources, synchronisation et doublons</p>
      </div>

      {SOURCES.map((s) => (
        <Card key={s.id}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="text-2xl">{s.icon}</div>
              <div className="flex-1">
                <CardTitle className="text-base">{s.label}</CardTitle>
                <p className="text-xs text-muted-foreground">Authentification : {s.authKind}</p>
              </div>
              <Badge variant="secondary">{counts[s.id] ?? 0} contacts</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Direction :</span>
              <Select
                value={directions[s.id]}
                onValueChange={(v) => updateDirection(s.id, v as Direction)}
              >
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">Lecture seule</SelectItem>
                  <SelectItem value="bidirectional">Bidirectionnel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info(`Connexion ${s.authKind} bientôt disponible`)}
            >
              <Users className="mr-2 h-4 w-4" /> Connecter
            </Button>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Doublons</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={scanDuplicates} disabled={scanning} variant="outline">
            {scanning ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Merge className="mr-2 h-4 w-4" />
            )}
            Analyser les doublons
          </Button>
          {duplicates && duplicates.length > 0 && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="mb-2 font-medium">{duplicates.length} groupe(s) de doublons détecté(s)</div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {duplicates.slice(0, 10).map((d) => (
                  <li key={d.key}>
                    <span className="font-mono">{d.key}</span> — {d.count} entrées
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => toast.info("Fusion : aperçu avant/après bientôt disponible")}
              >
                Fusionner ({duplicates.reduce((n, d) => n + d.count - 1, 0)} entrées)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
