import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { getSpaceByJoinToken, submitJoinRequest } from "@/lib/collab-join.functions";

export const Route = createFileRoute("/join/$token")({
  head: () => ({
    meta: [
      { title: "Rejoindre un projet collaboratif" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: JoinPage,
});

function JoinPage() {
  const { token } = Route.useParams();
  const getFn = useServerFn(getSpaceByJoinToken);
  const submitFn = useServerFn(submitJoinRequest);
  const { data, isLoading } = useQuery({
    queryKey: ["join-space", token],
    queryFn: () => getFn({ data: { token } }),
  });

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState<null | "ok" | "pending">(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Chargement…
      </div>
    );
  }

  if (!data?.space) {
    return (
      <div className="max-w-md mx-auto py-20 px-4 text-center">
        <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <h1 className="text-xl font-semibold mb-2">Lien invalide</h1>
        <p className="text-sm text-muted-foreground">
          Ce lien d'invitation n'est plus actif ou n'existe pas.
        </p>
      </div>
    );
  }

  const space = data.space;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      toast.error("Tous les champs sont requis");
      return;
    }
    setSending(true);
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const r = await submitFn({
        data: {
          token,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          appOrigin: origin || undefined,
        },
      });
      if (r.success) {
        setSubmitted(r.alreadyPending ? "pending" : "ok");
      } else {
        toast.error("Envoi impossible. Réessayez plus tard.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-md mx-auto">
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center justify-center w-12 h-12 rounded-lg text-2xl"
              style={{
                backgroundColor: (space.color ?? "#64748b") + "20",
                color: space.color ?? undefined,
              }}
            >
              {space.icon ?? "📁"}
            </span>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Projet collaboratif
              </p>
              <h1 className="text-lg font-semibold leading-tight">{space.name}</h1>
            </div>
          </div>

          {space.description && (
            <p className="text-sm text-muted-foreground border-l-2 border-border pl-3">
              {space.description}
            </p>
          )}

          {submitted ? (
            <div className="text-center py-6 space-y-2">
              <CheckCircle2 className="h-10 w-10 mx-auto text-green-600" />
              <h2 className="font-semibold">
                {submitted === "pending" ? "Demande déjà envoyée" : "Demande envoyée"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {submitted === "pending"
                  ? "Une demande est déjà en attente avec cet email."
                  : "Vous recevrez un email dès qu'elle sera validée par le propriétaire du projet."}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <p className="text-sm">
                Renseignez vos informations pour demander à rejoindre ce projet. Votre demande sera
                examinée par le propriétaire.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="first">Prénom</Label>
                  <Input
                    id="first"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="last">Nom</Label>
                  <Input
                    id="last"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                    required
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={sending}>
                {sending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Envoyer la demande
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
