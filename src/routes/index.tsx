import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  Calendar,
  CheckSquare,
  Mail,
  ShieldCheck,
  Users,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MyHub Pro — Hub unifié emails, tâches, agenda et contacts" },
      {
        name: "description",
        content:
          "MyHub Pro centralise vos emails, votre agenda, vos tâches et vos contacts dans une interface unique pensée pour les professionnels.",
      },
      { property: "og:title", content: "MyHub Pro — Hub de productivité unifié" },
      {
        property: "og:description",
        content:
          "Emails, agenda, tâches et contacts réunis. Conçu pour les professionnels exigeants.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://myhub-unified-life.lovable.app/" },
    ],
    links: [{ rel: "canonical", href: "https://myhub-unified-life.lovable.app/" }],
  }),
  component: LandingPage,
});

function LandingPage() {
  const { user } = useAuth();

  const features = [
    {
      icon: Mail,
      title: "Boîte de réception unifiée",
      desc: "Tous vos comptes Gmail, Outlook et IMAP au même endroit, avec tri intelligent par IA.",
    },
    {
      icon: Calendar,
      title: "Agenda synchronisé",
      desc: "Connectez Google Calendar et visualisez tous vos événements dans une vue claire.",
    },
    {
      icon: CheckSquare,
      title: "Tâches et projets",
      desc: "Transformez vos emails en tâches, organisez-les en Kanban ou Gantt.",
    },
    {
      icon: Users,
      title: "Contacts centralisés",
      desc: "Vos contacts professionnels enrichis automatiquement depuis vos échanges.",
    },
    {
      icon: Sparkles,
      title: "Assistance IA",
      desc: "Suggestions de réponses, classification automatique et résumés intelligents.",
    },
    {
      icon: ShieldCheck,
      title: "Conformité RGPD & HDS",
      desc: "Détection automatique des données sensibles et hébergement européen sécurisé.",
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
              M
            </div>
            <span className="text-lg font-semibold">MyHub Pro</span>
          </div>
          <nav className="flex items-center gap-2">
            <Link to="/privacy" className="text-sm text-muted-foreground hover:text-foreground px-3 py-2">
              Confidentialité
            </Link>
            {user ? (
              <Button asChild>
                <Link to="/dashboard">Mon espace</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link to="/login">Se connecter</Link>
              </Button>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Votre hub de productivité unifié
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          MyHub Pro réunit vos emails, votre agenda, vos tâches et vos contacts
          dans une interface unique, propulsée par l'intelligence artificielle.
          Pensé pour les professionnels qui veulent gagner du temps sans
          compromis sur la confidentialité.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link to={user ? "/dashboard" : "/login"}>
              {user ? "Accéder à mon espace" : "Commencer gratuitement"}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#fonctionnalites">Découvrir les fonctionnalités</a>
          </Button>
        </div>
      </section>

      {/* Features */}
      <section id="fonctionnalites" className="border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-center text-3xl font-semibold tracking-tight">
            Tout ce dont vous avez besoin, au même endroit
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            Une suite complète d'outils intégrés pour fluidifier votre journée
            de travail.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border bg-card p-6 shadow-sm"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">
          Prêt à reprendre le contrôle de votre journée ?
        </h2>
        <p className="mt-4 text-muted-foreground">
          Créez votre compte en quelques secondes et connectez vos outils.
        </p>
        <Button asChild size="lg" className="mt-8">
          <Link to={user ? "/dashboard" : "/login"}>
            {user ? "Aller à mon tableau de bord" : "Créer mon compte"}
          </Link>
        </Button>
      </section>

      {/* Footer */}
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} MyHub Pro</span>
          <div className="flex gap-6">
            <Link to="/privacy" className="hover:text-foreground">
              Politique de confidentialité
            </Link>
            <a
              href="mailto:contact@myhub-unified-life.lovable.app"
              className="hover:text-foreground"
            >
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
