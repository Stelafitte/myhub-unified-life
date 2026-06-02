import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, User as UserIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

// Liste raisonnable de fuseaux (sous-ensemble pratique). On garde la sélection
// libre via auto-détection.
const COMMON_TZ = [
  "Europe/Paris",
  "Europe/London",
  "Europe/Brussels",
  "Europe/Madrid",
  "Europe/Berlin",
  "Europe/Zurich",
  "Atlantic/Reykjavik",
  "America/New_York",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Africa/Casablanca",
  "Africa/Algiers",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Pacific/Auckland",
];

export type Step1Data = {
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  timezone: string;
  language: "fr" | "en";
};

export function Step1Profile({
  initialFirstName,
  initialLastName,
  initialAvatarUrl,
  onContinue,
}: {
  initialFirstName: string;
  initialLastName: string;
  initialAvatarUrl: string | null;
  onContinue: (data: Step1Data) => void;
}) {
  const { user } = useAuth();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [timezone, setTimezone] = useState<string>(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris";
    } catch {
      return "Europe/Paris";
    }
  });
  const [language, setLanguage] = useState<"fr" | "en">("fr");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // S'assure que le TZ détecté est dans la liste
  const tzOptions = COMMON_TZ.includes(timezone) ? COMMON_TZ : [timezone, ...COMMON_TZ];

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Merci de sélectionner une image");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await resizeImage(file, 256);
      setAvatarUrl(dataUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec du chargement de l'image");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("Prénom et nom requis");
      return;
    }
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        display_name: `${firstName.trim()} ${lastName.trim()}`,
        avatar_url: avatarUrl,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    onContinue({ firstName: firstName.trim(), lastName: lastName.trim(), avatarUrl, timezone, language });
  };

  const greeting = firstName.trim()
    ? `Bonjour ${firstName.trim()}, configurons MyHub Pro en 7 étapes`
    : "Configurons MyHub Pro en 7 étapes";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{greeting}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Commençons par votre profil. Tout est modifiable plus tard.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="group relative h-20 w-20 overflow-hidden rounded-full border-2 border-dashed border-border bg-muted/40 transition hover:border-primary"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <UserIcon className="h-8 w-8" />
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-white" />
            ) : (
              <Camera className="h-5 w-5 text-white" />
            )}
          </div>
        </button>
        <div className="space-y-1">
          <p className="text-sm font-medium">Photo de profil</p>
          <p className="text-xs text-muted-foreground">PNG, JPG — optionnel</p>
          {avatarUrl && (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAvatarUrl(null)}>
              Retirer
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="firstName">Prénom</Label>
          <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lastName">Nom</Label>
          <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Fuseau horaire</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tzOptions.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Langue</Label>
          <Select value={language} onValueChange={(v) => setLanguage(v as "fr" | "en")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fr">Français</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={submit} disabled={saving} size="lg">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Continuer
        </Button>
      </div>
    </div>
  );
}

async function resizeImage(file: File, max: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * ratio);
  const h = Math.round(bitmap.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.85);
}

// Évite warning ESLint sur useEffect importé non utilisé : on garde l'import
// disponible pour future extension du composant.
void useEffect;
