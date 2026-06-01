import { useState } from "react";
import { Loader2, Plus, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const OVH_EMAIL = "chu@myhub-pro.fr";

export function QuickAddOvh({ onAdded }: { onAdded: () => void }) {
  const { user } = useAuth();
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !password) return;
    setBusy(true);
    const { error } = await supabase.from("accounts").insert({
      user_id: user.id,
      name: "CHU",
      type: "imap",
      color: "#10b981",
      icon: "🏥",
      is_active: true,
      credentials: {
        email: OVH_EMAIL,
        server: "imap.mail.ovh.net",
        port: 993,
        ssl: true,
        username: OVH_EMAIL,
        password,
        smtp_server: "ssl0.ovh.net",
        smtp_port: 465,
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Compte ${OVH_EMAIL} ajouté`);
    setPassword("");
    onAdded();
  };

  return (
    <form onSubmit={submit} className="mx-2 mt-2 space-y-1.5 rounded-md border bg-muted/30 p-2">
      <div className="text-[11px] font-medium">Ajouter {OVH_EMAIL}</div>
      <div className="relative">
        <Input
          type={showPw ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mot de passe OVH"
          className="h-8 text-xs pr-9"
          autoComplete="off"
        />
        <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute inset-y-0 right-0 flex items-center pr-2 text-muted-foreground hover:text-foreground">
          {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      <Button type="submit" size="sm" disabled={!password || busy} className="h-7 w-full text-xs">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Plus className="mr-1 h-3 w-3" /> Connecter</>}
      </Button>
    </form>
  );
}
