import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Politique de confidentialité — MyHub Pro" },
      {
        name: "description",
        content:
          "Comment MyHub Pro collecte, utilise et protège vos données personnelles, y compris les données provenant de Google.",
      },
      { property: "og:title", content: "Politique de confidentialité — MyHub Pro" },
      {
        property: "og:url",
        content: "https://myhub-unified-life.lovable.app/privacy",
      },
    ],
    links: [
      { rel: "canonical", href: "https://myhub-unified-life.lovable.app/privacy" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
              M
            </div>
            <span className="font-semibold">MyHub Pro</span>
          </Link>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Accueil
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">
          Politique de confidentialité
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Dernière mise à jour : {new Date().toLocaleDateString("fr-FR")}
        </p>

        <div className="prose prose-sm dark:prose-invert mt-8 max-w-none space-y-6 text-foreground/90">
          <section>
            <h2 className="text-xl font-semibold">1. Qui sommes-nous</h2>
            <p>
              MyHub Pro est une application de productivité qui centralise emails,
              agenda, tâches et contacts pour les professionnels. La présente
              politique décrit les données que nous collectons et la manière dont
              nous les utilisons.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">2. Données collectées</h2>
            <ul className="list-disc pl-6">
              <li>
                <strong>Compte</strong> : adresse email, nom, mot de passe chiffré.
              </li>
              <li>
                <strong>Comptes connectés</strong> : jetons OAuth (Google, Microsoft,
                IMAP) chiffrés au repos, utilisés uniquement pour synchroniser vos
                données.
              </li>
              <li>
                <strong>Contenus</strong> : emails, événements, tâches, contacts
                synchronisés depuis vos comptes connectés.
              </li>
              <li>
                <strong>Données techniques</strong> : journaux d'erreurs, statistiques
                d'usage anonymisées.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold">
              3. Utilisation des données Google
            </h2>
            <p>
              L'utilisation par MyHub Pro des informations reçues depuis les API
              Google respectera la{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                Google API Services User Data Policy
              </a>
              , y compris les exigences d'utilisation limitée (Limited Use).
            </p>
            <p>
              Nous accédons à vos données Google Calendar uniquement pour afficher
              et synchroniser vos événements dans l'application. Nous ne vendons
              jamais ces données et ne les utilisons pas pour de la publicité.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">4. Finalités</h2>
            <ul className="list-disc pl-6">
              <li>Fournir les fonctionnalités de l'application.</li>
              <li>Améliorer la pertinence des suggestions IA (sur vos données uniquement).</li>
              <li>Assurer la sécurité et prévenir les fraudes.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold">5. Conservation</h2>
            <p>
              Vos données sont conservées tant que votre compte est actif. Vous
              pouvez à tout moment supprimer votre compte et toutes les données
              associées depuis Paramètres → Mon compte.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">6. Sécurité</h2>
            <p>
              Les jetons OAuth et les données sensibles sont chiffrés. Les emails
              susceptibles de contenir des données de santé sont automatiquement
              détectés et exclus du traitement IA, conformément au RGPD et au
              cadre HDS français.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">7. Vos droits (RGPD)</h2>
            <p>
              Vous disposez d'un droit d'accès, de rectification, d'effacement,
              d'opposition et de portabilité sur vos données. Pour exercer ces
              droits, contactez-nous à l'adresse ci-dessous.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">8. Révocation de l'accès</h2>
            <p>
              Vous pouvez à tout moment révoquer l'accès de MyHub Pro à votre
              compte Google depuis{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                la page de gestion des accès Google
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">9. Contact</h2>
            <p>
              Pour toute question relative à cette politique :{" "}
              <a
                href="mailto:contact@myhub-unified-life.lovable.app"
                className="text-primary underline"
              >
                contact@myhub-unified-life.lovable.app
              </a>
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} MyHub Pro</span>
          <Link to="/" className="hover:text-foreground">
            Accueil
          </Link>
        </div>
      </footer>
    </div>
  );
}
