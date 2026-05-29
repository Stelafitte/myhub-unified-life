import { useState } from "react";
import { Lock, Loader2, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSecureVault } from "@/lib/secure-vault-context";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onUnlocked?: () => void;
};

export function VaultPinDialog({ open, onOpenChange, onUnlocked }: Props) {
  const { initialized, create, unlock } = useSecureVault();
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length < 4) {
      toast.error("Le PIN doit faire au moins 4 caractères");
      return;
    }
    if (!initialized && pin !== pin2) {
      toast.error("Les deux PIN ne correspondent pas");
      return;
    }
    setBusy(true);
    try {
      if (initialized) {
        await unlock(pin);
        toast.success("Coffre déverrouillé");
      } else {
        await create(pin);
        toast.success("Coffre créé et déverrouillé");
      }
      setPin("");
      setPin2("");
      onOpenChange(false);
      onUnlocked?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {initialized ? <Lock className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            {initialized ? "Déverrouiller le coffre" : "Créer le coffre sécurisé"}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {initialized
              ? "Saisissez votre PIN pour accéder aux emails sensibles stockés localement (AES-256)."
              : "Choisissez un PIN. Il chiffre vos données de santé localement (AES-256, PBKDF2). Si vous l'oubliez, les données sont irrécupérables."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pin">PIN</Label>
            <Input
              id="pin"
              type="password"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••••"
              inputMode="numeric"
            />
          </div>
          {!initialized && (
            <div className="space-y-1.5">
              <Label htmlFor="pin2">Confirmer le PIN</Label>
              <Input
                id="pin2"
                type="password"
                value={pin2}
                onChange={(e) => setPin2(e.target.value)}
                placeholder="••••••"
                inputMode="numeric"
              />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {initialized ? "Déverrouiller" : "Créer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
