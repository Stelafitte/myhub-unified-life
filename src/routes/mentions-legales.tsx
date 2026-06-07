import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/mentions-legales")({
  head: () => ({
    meta: [
      { title: "Mentions légales — MyHub Pro" },
      {
        name: "description",
        content:
          "Mentions légales de MyHub Pro : éditeur, hébergeur, propriété intellectuelle et coordonnées.",
      },
      { property: "og:title", content: "Mentions légales — MyHub Pro" },
      {
        property: "og:url",
        content: "https://myhub-unified-life.lovable.app/mentions-legales",
      },
    ],
    links: [
      {
        rel: "canonical",
        href: "https://myhub-unified-life.lovable.app/mentions-legales",
      },
    ],
  }),
  component: MentionsLegales,
});

function MentionsLegales() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link
            to="/"
            className="text-lg font-semibold"
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              color: "#0f2744",
            }}
          >
            MyHub <span style={{ color: "#3b82f6" }}>Pro</span>
          </Link>
          <Link to="/" className="text-sm text-slate-600 hover:text-slate-900">
            ← Retour
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-12 prose prose-slate">
        <h1
          className="text-3xl font-bold"
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            color: "#0f2744",
          }}
        >
          Mentions légales
        </h1>
        <p className="text-sm text-slate-500">
          Dernière mise à jour : juin 2026
        </p>

        <section className="mt-8 space-y-6 text-slate-700 leading-relaxed">
          <div>
            <h2 className="text-xl font-semibold" style={{ color: "#0f2744" }}>
              Éditeur du site
            </h2>
            <p>
              <strong>MyHub Pro</strong>
              <br />
              Bordeaux, France
              <br />
              Contact :{" "}
              <a
                href="mailto:chu@myhub-pro.fr"
                className="text-blue-600 underline"
              >
                chu@myhub-pro.fr
              </a>
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold" style={{ color: "#0f2744" }}>
              Directeur de la publication
            </h2>
            <p>Le directeur de la publication est le représentant légal de MyHub Pro.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold" style={{ color: "#0f2744" }}>
              Hébergement
            </h2>
            <p>
              L'application MyHub Pro est hébergée au sein de l'Union européenne
              afin de garantir la conformité au Règlement Général sur la
              Protection des Données (RGPD).
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold" style={{ color: "#0f2744" }}>
              Propriété intellectuelle
            </h2>
            <p>
              L'ensemble des contenus présents sur ce site (textes, images,
              logos, marques, mises en page, codes sources) sont la propriété
              exclusive de MyHub Pro ou de ses partenaires. Toute reproduction,
              représentation ou diffusion, partielle ou totale, est interdite
              sans autorisation écrite préalable.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold" style={{ color: "#0f2744" }}>
              Données personnelles
            </h2>
            <p>
              Le traitement des données personnelles est décrit dans notre{" "}
              <Link to="/privacy" className="text-blue-600 underline">
                politique de confidentialité
              </Link>
              . Conformément au RGPD, vous disposez d'un droit d'accès, de
              rectification, d'opposition et de suppression de vos données.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold" style={{ color: "#0f2744" }}>
              Responsabilité
            </h2>
            <p>
              MyHub Pro met tout en œuvre pour assurer la fiabilité des
              informations diffusées sur ce site. L'éditeur ne saurait toutefois
              être tenu responsable des erreurs, omissions ou indisponibilités
              du service.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold" style={{ color: "#0f2744" }}>
              Droit applicable
            </h2>
            <p>
              Le présent site est soumis au droit français. En cas de litige,
              les tribunaux français seront seuls compétents.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 mt-12">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 text-xs text-slate-500 text-center">
          © 2026 MyHub Pro — Bordeaux, France
        </div>
      </footer>
    </div>
  );
}
