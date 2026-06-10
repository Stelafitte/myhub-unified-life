import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Cloud, Mail as MailIcon, RefreshCw, Trash2, Apple, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { syncGoogleContacts } from "@/lib/api/google-contacts.functions";
import { listGoogleCalendarConnections } from "@/lib/api/google-calendar.functions";
import { syncOutlookContacts } from "@/lib/api/outlook-contacts.functions";
import { listOutlookConnections } from "@/lib/api/outlook-oauth.functions";
import {
  connectICloudContacts,
  listICloudConnections,
  deleteICloudConnection,
  syncICloudContacts,
} from "@/lib/api/icloud-contacts.functions";

type GoogleConn = { id: string; label: string; google_email: string | null };
type OutlookConn = { id: string; label: string; outlook_email: string | null };
type ICloudConn = { id: string; apple_id: string; label: string; last_sync_at: string | null };

export function ContactConnectionsBar({ onSynced }: { onSynced?: () => void }) {
  const syncGoogle = useServerFn(syncGoogleContacts);
  const listGoogle = useServerFn(listGoogleCalendarConnections);
  const syncOutlook = useServerFn(syncOutlookContacts);
  const listOutlook = useServerFn(listOutlookConnections);
  const connectICloud = useServerFn(connectICloudContacts);
  const listICloud = useServerFn(listICloudConnections);
  const delICloud = useServerFn(deleteICloudConnection);
  const syncICloud = useServerFn(syncICloudContacts);

  const [google, setGoogle] = useState<GoogleConn[]>([]);
  const [outlook, setOutlook] = useState<OutlookConn[]>([]);
  const [icloud, setICloud] = useState<ICloudConn[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  // iCloud modal
  const [icloudOpen, setIcloudOpen] = useState(false);
  const [appleId, setAppleId] = useState("");
  const [appPwd, setAppPwd] = useState("");
  const [label, setLabel] = useState("iCloud");
  const [connecting, setConnecting] = useState(false);

  const refresh = async () => {
    try {
      const [g, o, i] = await Promise.all([
        listGoogle().catch(() => ({ connections: [] })),
        listOutlook().catch(() => ({ connections: [] })),
        listICloud().catch(() => ({ connections: [] })),
      ]);
      setGoogle((g as { connections: GoogleConn[] }).connections ?? []);
      setOutlook((o as { connections: OutlookConn[] }).connections ?? []);
      setICloud((i as { connections: ICloudConn[] }).connections ?? []);
    } catch (e) {
      console.warn("Failed to list contact connections", e);
    }
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSync = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      const r = (await fn()) as { created?: number; updated?: number };
      toast.success(`Sync OK — ${r.created ?? 0} créé(s), ${r.updated ?? 0} mis à jour`);
      onSynced?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la synchronisation");
    } finally {
      setBusy(null);
    }
  };

  const handleConnectICloud = async () => {
    if (!appleId || !appPwd) {
      toast.error("Apple ID et mot de passe d'application requis");
      return;
    }
    setConnecting(true);
    try {
      await connectICloud({ data: { appleId, appPassword: appPwd, label, category: "perso" } });
      toast.success("iCloud connecté");
      setIcloudOpen(false);
      setAppPwd("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connexion iCloud échouée");
    } finally {
      setConnecting(false);
    }
  };

  const handleDeleteICloud = async (id: string) => {
    if (!confirm("Supprimer cette connexion iCloud ?")) return;
    try {
      await delICloud({ data: { id } });
      toast.success("Connexion supprimée");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Suppression échouée");
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {/* Google */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2 sm:px-3">
              <MailIcon className="h-3.5 w-3.5 text-blue-600" />
              <span className="hidden sm:inline">Google</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Google Contacts</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {google.length === 0 && (
              <DropdownMenuItem disabled>
                Aucun compte Google connecté
              </DropdownMenuItem>
            )}
            {google.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => runSync(`g-${c.id}`, () => syncGoogle({ data: { connectionId: c.id } }))}
                disabled={busy === `g-${c.id}`}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                {busy === `g-${c.id}` ? "Sync…" : `Sync ${c.google_email ?? c.label}`}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Outlook */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2 sm:px-3">
              <MailIcon className="h-3.5 w-3.5 text-sky-600" />
              <span className="hidden sm:inline">Outlook</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Outlook Contacts</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {outlook.length === 0 && (
              <DropdownMenuItem disabled>Aucun compte Outlook connecté</DropdownMenuItem>
            )}
            {outlook.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => runSync(`o-${c.id}`, () => syncOutlook({ data: { connectionId: c.id } }))}
                disabled={busy === `o-${c.id}`}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                {busy === `o-${c.id}` ? "Sync…" : `Sync ${c.outlook_email ?? c.label}`}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* iCloud */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2 sm:px-3">
              <Apple className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">iCloud</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[240px]">
            <DropdownMenuLabel>iCloud Contacts</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {icloud.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-1 px-2 py-1">
                <button
                  className="flex flex-1 items-center gap-2 text-sm hover:underline disabled:opacity-50"
                  disabled={busy === `i-${c.id}`}
                  onClick={() => runSync(`i-${c.id}`, () => syncICloud({ data: { connectionId: c.id } }))}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span className="truncate">{busy === `i-${c.id}` ? "Sync…" : c.apple_id}</span>
                </button>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeleteICloud(c.id)}
                  title="Supprimer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {icloud.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={() => setIcloudOpen(true)}>
              <Cloud className="mr-2 h-3.5 w-3.5" />
              Connecter un compte iCloud
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={icloudOpen} onOpenChange={setIcloudOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connecter iCloud Contacts</DialogTitle>
            <DialogDescription>
              Crée un mot de passe d'application sur{" "}
              <a
                href="https://account.apple.com/account/manage"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                appleid.apple.com → Connexion et sécurité → Mots de passe pour applications
              </a>
              . Ton mot de passe est chiffré (AES-256-GCM) avant stockage.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed">
              ⚠️ <strong>Important</strong> : Apple bloque CardDAV avec un mot de passe Apple ID normal.
              Tu dois utiliser un <strong>mot de passe d'application</strong> au format{" "}
              <code className="rounded bg-background/60 px-1">xxxx-xxxx-xxxx-xxxx</code> (16 caractères)
              généré sur{" "}
              <a
                href="https://account.apple.com/account/manage"
                target="_blank"
                rel="noreferrer"
                className="underline font-medium"
              >
                appleid.apple.com
              </a>
              {" "}→ Connexion et sécurité → Mots de passe pour applications.
            </div>
            <div className="space-y-1">
              <Label htmlFor="apple-id">Apple ID (email)</Label>
              <Input
                id="apple-id"
                type="email"
                placeholder="prenom@icloud.com"
                value={appleId}
                onChange={(e) => setAppleId(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="app-pwd">Mot de passe d'application (16 car.)</Label>
              <Input
                id="app-pwd"
                type="password"
                placeholder="xxxx-xxxx-xxxx-xxxx"
                value={appPwd}
                onChange={(e) => setAppPwd(e.target.value)}
                autoComplete="off"
              />
              {appPwd.length > 0 && !/^[a-z0-9]{16}$|^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/i.test(appPwd.replace(/\s+/g, "")) && (
                <p className="text-xs text-amber-600">
                  Format attendu : 16 caractères (avec ou sans tirets). Ce n'est pas ton mot de passe Apple ID habituel.
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="label">Libellé</Label>
              <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIcloudOpen(false)} disabled={connecting}>
              Annuler
            </Button>
            <Button onClick={handleConnectICloud} disabled={connecting}>
              {connecting ? "Connexion…" : "Connecter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
