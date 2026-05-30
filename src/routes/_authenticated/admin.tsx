import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/lib/use-role";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Shield, Mail, Activity, UserPlus, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  is_suspended: boolean;
  quota_emails: number;
  quota_storage_mb: number;
};
type InvitationRow = {
  id: string;
  email: string;
  token: string;
  role: "admin" | "user";
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};
type AuditRow = {
  id: string;
  user_id: string | null;
  action: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};
type SourceAccountRow = {
  id: string;
  name: string;
  type: string;
  tombstones: number;
};

function AdminPage() {
  const { isAdmin, loading } = useIsAdmin();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [roles, setRoles] = useState<Record<string, string[]>>({});
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [sources, setSources] = useState<SourceAccountRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "user">("user");
  const [busy, setBusy] = useState(false);
  const [purgingId, setPurgingId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/inbox", replace: true });
  }, [isAdmin, loading, navigate]);

  const refresh = async () => {
    const [p, r, i, a, accs, ts] = await Promise.all([
      supabase.from("profiles").select("id,email,display_name,created_at,is_suspended,quota_emails,quota_storage_mb").order("created_at"),
      supabase.from("user_roles").select("user_id,role"),
      supabase.from("invitations").select("*").order("created_at", { ascending: false }),
      supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("accounts").select("id,name,type,is_active").eq("is_active", true),
      supabase.from("deleted_emails").select("account_id"),
    ]);
    setProfiles((p.data as ProfileRow[]) ?? []);
    const map: Record<string, string[]> = {};
    ((r.data as Array<{ user_id: string; role: string }>) ?? []).forEach((row) => {
      map[row.user_id] = [...(map[row.user_id] ?? []), row.role];
    });
    setRoles(map);
    setInvitations((i.data as InvitationRow[]) ?? []);
    setAudit((a.data as AuditRow[]) ?? []);

    const counts: Record<string, number> = {};
    ((ts.data as Array<{ account_id: string }>) ?? []).forEach((row) => {
      counts[row.account_id] = (counts[row.account_id] ?? 0) + 1;
    });
    const srcRows: SourceAccountRow[] = ((accs.data as Array<{ id: string; name: string; type: string }>) ?? [])
      .map((acc) => ({ id: acc.id, name: acc.name, type: acc.type, tombstones: counts[acc.id] ?? 0 }));
    setSources(srcRows);
  };

  const purgeSource = async (accountId: string, name: string) => {
    if (!confirm(`Vider définitivement sur le serveur les mails supprimés du compte "${name}" ?\n\nCette action est IRRÉVERSIBLE côté provider.`)) return;
    setPurgingId(accountId);
    try {
      const { data, error } = await supabase.functions.invoke("purge-imap-source", { body: { account_id: accountId } });
      if (error) throw error;
      const total = (data?.results ?? []).reduce((s: number, r: { purged?: number }) => s + (r.purged ?? 0), 0);
      toast.success(`${total} email(s) purgé(s) sur la source`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la purge");
    } finally {
      setPurgingId(null);
    }
  };

  useEffect(() => {
    if (isAdmin) refresh();
  }, [isAdmin]);

  const toggleSuspend = async (id: string, suspended: boolean) => {
    setBusy(true);
    await supabase.from("profiles").update({ is_suspended: suspended }).eq("id", id);
    setBusy(false);
    refresh();
  };

  const updateQuota = async (id: string, field: "quota_emails" | "quota_storage_mb", v: number) => {
    const patch = field === "quota_emails" ? { quota_emails: v } : { quota_storage_mb: v };
    await supabase.from("profiles").update(patch).eq("id", id);
  };

  const toggleAdmin = async (userId: string, makeAdmin: boolean) => {
    setBusy(true);
    if (makeAdmin) {
      await supabase.from("user_roles").insert({ user_id: userId, role: "admin" });
    } else {
      await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", "admin");
    }
    setBusy(false);
    refresh();
  };

  const sendInvitation = async () => {
    if (!inviteEmail.includes("@")) return toast.error("Email invalide");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setBusy(true);
    const { data, error } = await supabase.from("invitations").insert({
      email: inviteEmail,
      role: inviteRole,
      invited_by: user.id,
    }).select().single();
    setBusy(false);
    if (error) return toast.error(error.message);
    setInviteEmail("");
    toast.success("Invitation créée");
    const link = `${window.location.origin}/login?invite=${data.token}`;
    navigator.clipboard.writeText(link).catch(() => {});
    toast.info("Lien copié dans le presse-papier");
    refresh();
  };

  const copyInviteLink = (token: string) => {
    const link = `${window.location.origin}/login?invite=${token}`;
    navigator.clipboard.writeText(link);
    toast.success("Lien copié");
  };

  const revokeInvite = async (id: string) => {
    await supabase.from("invitations").delete().eq("id", id);
    refresh();
  };

  if (loading) return <div className="text-sm text-muted-foreground">Vérification des droits…</div>;
  if (!isAdmin) return null;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Shield className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
          <p className="text-sm text-muted-foreground">Utilisateurs, invitations, journal d'activité</p>
        </div>
      </div>

      <Tabs defaultValue="users">
        <TabsList className="mb-6">
          <TabsTrigger value="users"><Shield className="mr-2 h-4 w-4" />Utilisateurs ({profiles.length})</TabsTrigger>
          <TabsTrigger value="invitations"><Mail className="mr-2 h-4 w-4" />Invitations</TabsTrigger>
          <TabsTrigger value="audit"><Activity className="mr-2 h-4 w-4" />Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle>Liste des utilisateurs</CardTitle>
              <CardDescription>Quotas, rôles et suspension</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Utilisateur</TableHead>
                    <TableHead>Rôles</TableHead>
                    <TableHead>Quota emails</TableHead>
                    <TableHead>Stockage (Mo)</TableHead>
                    <TableHead>Admin</TableHead>
                    <TableHead>Actif</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((p) => {
                    const isUserAdmin = (roles[p.id] ?? []).includes("admin");
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium">{p.display_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{p.email}</div>
                        </TableCell>
                        <TableCell>
                          {(roles[p.id] ?? ["user"]).map((r) => (
                            <Badge key={r} variant={r === "admin" ? "default" : "secondary"} className="mr-1">{r}</Badge>
                          ))}
                        </TableCell>
                        <TableCell>
                          <Input type="number" defaultValue={p.quota_emails} className="h-8 w-24"
                            onBlur={(e) => updateQuota(p.id, "quota_emails", Number(e.target.value))} />
                        </TableCell>
                        <TableCell>
                          <Input type="number" defaultValue={p.quota_storage_mb} className="h-8 w-24"
                            onBlur={(e) => updateQuota(p.id, "quota_storage_mb", Number(e.target.value))} />
                        </TableCell>
                        <TableCell>
                          <Switch checked={isUserAdmin} onCheckedChange={(v) => toggleAdmin(p.id, v)} disabled={busy} />
                        </TableCell>
                        <TableCell>
                          <Switch checked={!p.is_suspended} onCheckedChange={(v) => toggleSuspend(p.id, !v)} disabled={busy} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invitations">
          <Card>
            <CardHeader>
              <CardTitle>Nouvelle invitation</CardTitle>
              <CardDescription>Lien valide 48 heures</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <div className="flex-1 min-w-[200px] space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="user@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label>Rôle</Label>
                  <select className="h-9 rounded-md border bg-background px-2 text-sm" value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "admin" | "user")}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <Button onClick={sendInvitation} disabled={busy}>
                    <UserPlus className="mr-2 h-4 w-4" /> Inviter
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Invitations</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Rôle</TableHead>
                    <TableHead>Expire</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map((inv) => {
                    const expired = new Date(inv.expires_at) < new Date();
                    return (
                      <TableRow key={inv.id}>
                        <TableCell>{inv.email}</TableCell>
                        <TableCell><Badge variant="secondary">{inv.role}</Badge></TableCell>
                        <TableCell className="text-xs">{new Date(inv.expires_at).toLocaleString("fr-FR")}</TableCell>
                        <TableCell>
                          {inv.accepted_at ? <Badge>Acceptée</Badge>
                            : expired ? <Badge variant="destructive">Expirée</Badge>
                            : <Badge variant="outline">En attente</Badge>}
                        </TableCell>
                        <TableCell className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => copyInviteLink(inv.token)}>
                            <Copy className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => revokeInvite(inv.id)}>Révoquer</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>Journal d'activité (100 derniers)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Utilisateur</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">Aucun événement</TableCell></TableRow>
                  )}
                  {audit.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs">{new Date(row.created_at).toLocaleString("fr-FR")}</TableCell>
                      <TableCell className="text-xs">{row.user_id?.slice(0, 8) ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline">{row.action}</Badge></TableCell>
                      <TableCell className="text-xs">{row.ip ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
