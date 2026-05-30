import { createFileRoute } from "@tanstack/react-router";
import { Map, CheckCircle2, Circle, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Status = "done" | "todo" | "blocked";
type Item = { title: string; desc: string; status: Status; priority?: "haute" | "moyenne" | "basse" };

const SECTIONS: { title: string; items: Item[] }[] = [
  {
    title: "Authentification & Sécurité",
    items: [
      { title: "Login / Inscription email + mdp", desc: "Avec confirmation mot de passe et toggle œil", status: "done" },
      { title: "OAuth Google / Apple / Microsoft", desc: "Via Lovable Cloud Auth (à activer côté config)", status: "todo", priority: "haute" },
      { title: "Reconnaissance faciale (Face ID / Touch ID)", desc: "WebAuthn / Passkeys sur iPhone et Mac", status: "todo", priority: "moyenne" },
      { title: "App iOS native dédiée", desc: "Wrapper Capacitor ou app SwiftUI pour Face ID natif + notifications push", status: "todo", priority: "basse" },
      { title: "Supprimer popup iCloud Keychain", desc: "Le popup d'autocomplétion Safari/iCloud s'affiche au focus des champs login. Échap ne le ferme pas. Tester autoComplete='off' + attribut data-1p-ignore, ou doc utilisateur pour purger les entrées iCloud", status: "todo", priority: "moyenne" },
    ],
  },
  {
    title: "Comptes Email & Synchronisation",
    items: [
      { title: "UI gestion des comptes", desc: "Wizard 3 étapes, presets IMAP/OVH, couleurs, icônes", status: "done" },
      { title: "OAuth réel Gmail / Outlook", desc: "Flow OAuth2 + stockage tokens chiffrés + refresh", status: "todo", priority: "haute" },
      { title: "Sync IMAP réelle (background)", desc: "Server function + cron pour fetch + push", status: "todo", priority: "haute" },
      { title: "Test de connexion réel", desc: "Actuellement simulé — brancher sur backend", status: "todo", priority: "moyenne" },
    ],
  },
  {
    title: "Modules métier",
    items: [
      { title: "Inbox unifiée", desc: "Vue threads multi-comptes, filtres, labels", status: "todo", priority: "haute" },
      { title: "Calendrier", desc: "Vue mois/semaine/jour, multi-agendas, drag&drop", status: "todo", priority: "haute" },
      { title: "Contacts", desc: "Fusion multi-sources, dédup, groupes", status: "todo", priority: "moyenne" },
      { title: "Tâches", desc: "Listes, priorités, due dates, sync Todoist/MS To Do", status: "todo", priority: "moyenne" },
      { title: "Plan d'opération Gantt", desc: "Vue Gantt globale projets/tâches", status: "todo", priority: "basse" },
    ],
  },
  {
    title: "Préférences & Données",
    items: [
      { title: "Thème dark/light/auto", desc: "Persistant via localStorage", status: "done" },
      { title: "Export JSON complet", desc: "Toutes les tables utilisateur", status: "done" },
      { title: "Mode offline PWA", desc: "Service worker + cache stratégique + sync différée", status: "todo", priority: "moyenne" },
      { title: "Notifications push", desc: "Web Push API + préférences par type", status: "todo", priority: "moyenne" },
      { title: "i18n (FR/EN)", desc: "Extraction strings + provider react-i18next", status: "todo", priority: "basse" },
    ],
  },
];

const statusIcon = (s: Status) =>
  s === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    : s === "blocked" ? <AlertCircle className="h-4 w-4 text-destructive" />
    : <Circle className="h-4 w-4 text-muted-foreground" />;

const priorityVariant = (p?: Item["priority"]) =>
  p === "haute" ? "destructive" : p === "moyenne" ? "default" : "secondary";

export const Route = createFileRoute("/_authenticated/roadmap")({
  component: RoadmapPage,
});

function RoadmapPage() {
  const total = SECTIONS.flatMap(s => s.items).length;
  const done = SECTIONS.flatMap(s => s.items).filter(i => i.status === "done").length;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Map className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Roadmap & tâches résiduelles</h1>
          <p className="text-sm text-muted-foreground">{done} terminées sur {total}</p>
        </div>
      </div>

      <div className="space-y-6">
        {SECTIONS.map((section) => (
          <section key={section.title} className="rounded-xl border bg-card">
            <header className="border-b px-5 py-3">
              <h2 className="text-sm font-semibold">{section.title}</h2>
            </header>
            <ul className="divide-y">
              {section.items.map((item) => (
                <li key={item.title} className="flex items-start gap-3 px-5 py-3">
                  <div className="mt-0.5">{statusIcon(item.status)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm font-medium ${item.status === "done" ? "text-muted-foreground line-through" : ""}`}>
                        {item.title}
                      </p>
                      {item.priority && item.status !== "done" && (
                        <Badge variant={priorityVariant(item.priority) as never} className="text-[10px]">
                          {item.priority}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
