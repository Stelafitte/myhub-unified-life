import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Download, ShieldAlert, KeyRound, LogOut, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

export function AccountSection() {
  const { user, signOut } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [factors, setFactors] = useState<Array<{ id: string; friendly_name?: string | null }>>([]);
  const [enrollQr, setEnrollQr] = useState<{ qr: string; secret: string; factorId: string } | null>(null);
  const [verifyCode, setVerifyCode] = useState("");

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("first_name,last_name,email,totp_enabled").eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setFirstName(data.first_name ?? "");
        setLastName(data.last_name ?? "");
        setEmail(data.email ?? user.email ?? "");
        setTotpEnabled(!!data.totp_enabled);
      });
    supabase.auth.mfa.listFactors().then(({ data }) => {
      if (data) setFactors(data.totp ?? []);
    });
  }, [user]);

  const saveProfile = async () => {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update({
      first_name: firstName, last_name: lastName, display_name: `${firstName} ${lastName}`.trim() || null,
    }).eq("id", user.id);
    setBusy(false);
    if (error) toast.error(error.message); else toast.success("Profil mis à jour");
  };

  const updateEmail = async () => {
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ email });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Email de confirmation envoyé");
  };

  const updatePassword = async () => {
    if (newPw.length < 6) return toast.error("Mot de passe trop court");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Mot de passe mis à jour"); setNewPw(""); }
  };

  const enroll2FA = async () => {
    setBusy(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setBusy(false);
    if (error || !data) return toast.error(error?.message ?? "Erreur");
    setEnrollQr({ qr: data.totp.qr_code, secret: data.totp.secret, factorId: data.id });
  };

  const verify2FA = async () => {
    if (!enrollQr) return;
    setBusy(true);
    const { data: chall } = await supabase.auth.mfa.challenge({ factorId: enrollQr.factorId });
    if (!chall) { setBusy(false); return toast.error("Challenge échoué"); }
    const { error } = await supabase.auth.mfa.verify({ factorId: enrollQr.factorId, challengeId: chall.id, code: verifyCode });
    setBusy(false);
    if (error) return toast.error(error.message);
    await supabase.from("profiles").update({ totp_enabled: true }).eq("id", user!.id);
    setTotpEnabled(true);
    setEnrollQr(null);
    setVerifyCode("");
    toast.success("2FA activée");
    const { data } = await supabase.auth.mfa.listFactors();
    if (data) setFactors(data.totp ?? []);
  };

  const disable2FA = async (factorId: string) => {
    setBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (error) return toast.error(error.message);
    await supabase.from("profiles").update({ totp_enabled: false }).eq("id", user!.id);
    setTotpEnabled(false);
    setFactors((f) => f.filter((x) => x.id !== factorId));
    toast.success("2FA désactivée");
  };

  const signOutOthers = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signOut({ scope: "others" });
    setBusy(false);
    if (error) toast.error(error.message); else toast.success("Autres sessions déconnectées");
  };

  const exportData = async () => {
    if (!user) return;
    setBusy(true);
    const [emails, tasks, meetings, contacts, documents, accounts, profile] = await Promise.all([
      supabase.from("emails").select("*").eq("user_id", user.id),
      supabase.from("tasks").select("*").eq("user_id", user.id),
      supabase.from("meetings").select("*").eq("user_id", user.id),
      supabase.from("contacts").select("*").eq("user_id", user.id),
      supabase.from("documents").select("*").eq("user_id", user.id),
      supabase.from("accounts").select("id,name,type,created_at").eq("user_id", user.id),
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    ]);
    const payload = {
      exported_at: new Date().toISOString(),
      user: { id: user.id, email: user.email },
      profile: profile.data,
      emails: emails.data ?? [],
      tasks: tasks.data ?? [],
      meetings: meetings.data ?? [],
      contacts: contacts.data ?? [],
      documents: documents.data ?? [],
      accounts: accounts.data ?? [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `myhubpro-export-${user.id}.json`; a.click();
    URL.revokeObjectURL(url);
    setBusy(false);
    toast.success("Export RGPD téléchargé");
  };

  const deleteAccount = async () => {
    if (!user) return;
    setBusy(true);
    // Soft-flag: mark suspended + delete data, then sign out (full deletion of auth user requires admin API)
    await supabase.from("profiles").update({ is_suspended: true }).eq("id", user.id);
    await Promise.all([
      supabase.from("emails").delete().eq("user_id", user.id),
      supabase.from("tasks").delete().eq("user_id", user.id),
      supabase.from("meetings").delete().eq("user_id", user.id),
      supabase.from("contacts").delete().eq("user_id", user.id),
      supabase.from("documents").delete().eq("user_id", user.id),
      supabase.from("accounts").delete().eq("user_id", user.id),
    ]);
    await signOut();
    toast.success("Données supprimées. Contactez le support pour la suppression définitive du compte.");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Informations personnelles</CardTitle>
          <CardDescription>Votre identité dans MyHub Pro</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
          <Button onClick={saveProfile} disabled={busy}>Enregistrer</Button>
          <Separator />
          <div className="space-y-1.5">
            <Label>Email</Label>
            <div className="flex gap-2">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Button variant="outline" onClick={updateEmail} disabled={busy}>Changer</Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Nouveau mot de passe</Label>
            <div className="flex gap-2">
              <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="••••••" />
              <Button variant="outline" onClick={updatePassword} disabled={busy}>
                <KeyRound className="mr-2 h-4 w-4" /> Mettre à jour
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Authentification à deux facteurs (2FA)</CardTitle>
          <CardDescription>Protégez votre compte avec une application TOTP</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">2FA TOTP</p>
              <p className="text-xs text-muted-foreground">{totpEnabled ? "Activée" : "Désactivée"}</p>
            </div>
            <Switch checked={totpEnabled} onCheckedChange={(v) => {
              if (v) enroll2FA();
              else if (factors[0]) disable2FA(factors[0].id);
            }} disabled={busy} />
          </div>
          {enrollQr && (
            <div className="rounded-md border p-4 space-y-3">
              <p className="text-sm">Scannez ce QR code avec Google Authenticator, 1Password, Authy…</p>
              <img src={enrollQr.qr} alt="QR 2FA" className="h-44 w-44 border bg-white p-2" />
              <p className="text-xs text-muted-foreground break-all">Ou saisissez : <code>{enrollQr.secret}</code></p>
              <div className="flex gap-2">
                <Input value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)} placeholder="Code à 6 chiffres" maxLength={6} />
                <Button onClick={verify2FA} disabled={busy || verifyCode.length !== 6}>Vérifier</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions actives</CardTitle>
          <CardDescription>Déconnecter les autres appareils connectés</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={signOutOthers} disabled={busy}>
            <LogOut className="mr-2 h-4 w-4" /> Déconnecter les autres appareils
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" /> Zone de danger
          </CardTitle>
          <CardDescription>Actions irréversibles</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" onClick={exportData} disabled={busy}>
            <Download className="mr-2 h-4 w-4" /> Exporter mes données (RGPD)
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Supprimer mon compte</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer définitivement votre compte ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Toutes vos données (emails, tâches, réunions, contacts, documents) seront effacées. Cette action est irréversible.
                  Pensez à exporter vos données avant.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={deleteAccount} className="bg-destructive text-destructive-foreground">
                  Supprimer définitivement
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
