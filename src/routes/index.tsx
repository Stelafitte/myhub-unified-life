import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import {
  Mail,
  Calendar,
  CheckSquare,
  Users,
  MessageCircle,
  ShieldCheck,
  Hospital,
  GraduationCap,
  Users2,
  Lock,
  Globe,
  FileCheck2,
  Database,
  Sparkles,
  ArrowRight,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title:
          "MyHub Pro — Hub de productivité pour les professionnels de santé",
      },
      {
        name: "description",
        content:
          "MyHub Pro unifie vos emails, agendas, tâches, réunions et espaces collaboratifs dans une interface unique, propulsée par l'IA. Conçu pour les cardiologues, universitaires et chercheurs.",
      },
      {
        property: "og:title",
        content:
          "MyHub Pro — Hub de productivité pour les professionnels de santé",
      },
      {
        property: "og:description",
        content:
          "Emails, agenda, tâches, réunions et espaces collaboratifs unifiés par l'IA. Pour cardiologues, universitaires et chercheurs.",
      },
      { property: "og:type", content: "website" },
      {
        property: "og:url",
        content: "https://myhub-unified-life.lovable.app/",
      },
    ],
    links: [
      {
        rel: "canonical",
        href: "https://myhub-unified-life.lovable.app/",
      },
    ],
  }),
  component: LandingPage,
});

const NAVY = "#0f2744";
const ACCENT = "#3b82f6";

function LandingPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [user, loading, navigate]);

  if (user) return null;

  return (
    <div
      className="min-h-screen bg-white text-slate-800"
      style={{
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <Nav />
      <Hero />
      <Stats />
      <Features />
      <Audiences />
      <Security />
      <Integrations />
      <Testimonial />
      <ContactForm />
      <Footer />
    </div>
  );
}

/* ─────────────────────────  NAV  ───────────────────────── */
function Nav() {
  return (
    <header
      className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200"
      style={{ borderBottomColor: "#e2e8f0" }}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2 group">
          <div
            className="h-9 w-9 rounded-md flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: NAVY }}
          >
            M
          </div>
          <span
            className="text-lg font-semibold tracking-tight"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: NAVY }}
          >
            MyHub <span style={{ color: ACCENT }}>Pro</span>
          </span>
        </a>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
          <a href="#features" className="hover:text-slate-900">
            Fonctionnalités
          </a>
          <a href="#security" className="hover:text-slate-900">
            Sécurité
          </a>
          <a href="#about" className="hover:text-slate-900">
            À propos
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            to="/login"
            className="hidden sm:inline-flex text-sm font-medium px-3 py-2 rounded-md text-slate-700 hover:text-slate-900"
          >
            Se connecter
          </Link>
          <a
            href="#contact"
            className="inline-flex items-center gap-1 text-sm font-semibold px-4 py-2 rounded-md text-white shadow-sm hover:opacity-90 transition"
            style={{ backgroundColor: NAVY }}
          >
            Demander un accès
          </a>
        </div>
      </div>
    </header>
  );
}

/* ─────────────────────────  HERO  ───────────────────────── */
function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, #f8fafc 0%, #ffffff 70%)",
      }}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-16 pb-20 md:pt-24 md:pb-28 grid md:grid-cols-2 gap-10 items-center">
        <div>
          <span
            className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1 rounded-full"
            style={{
              backgroundColor: "#eff6ff",
              color: NAVY,
              border: "1px solid #dbeafe",
            }}
          >
            🏥 Conçu pour les professionnels de santé
          </span>

          <h1
            className="mt-5 text-4xl md:text-5xl font-bold leading-tight tracking-tight"
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              color: NAVY,
            }}
          >
            Votre hub de productivité{" "}
            <span style={{ color: ACCENT }}>médicale et universitaire</span>
          </h1>

          <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-xl">
            MyHub Pro unifie vos emails, agendas, tâches, réunions et espaces
            collaboratifs dans une interface unique, propulsée par l'IA. Conçu
            pour les cardiologues, universitaires et chercheurs.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <a
              href="#features"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md text-white font-semibold shadow-sm hover:opacity-90 transition"
              style={{ backgroundColor: NAVY }}
            >
              🚀 Découvrir les fonctionnalités
            </a>
            <a
              href="#contact"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md font-semibold border-2 hover:bg-slate-50 transition"
              style={{ borderColor: NAVY, color: NAVY }}
            >
              📧 Demander un accès
            </a>
          </div>

          <div className="mt-6 text-xs text-slate-500">
            Sur invitation • Données hébergées en Europe • Conforme RGPD
          </div>
        </div>

        {/* Mockup */}
        <div className="relative">
          <div
            className="absolute -inset-4 rounded-2xl opacity-30 blur-2xl"
            style={{
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.4), rgba(15,39,68,0.4))",
            }}
          />
          <div
            className="relative rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
            style={{ boxShadow: "0 25px 60px -15px rgba(15,39,68,0.25)" }}
          >
            <div
              className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-100"
              style={{ backgroundColor: "#f8fafc" }}
            >
              <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
              <span className="ml-3 text-[10px] text-slate-400 font-mono">
                myhub-pro.fr/dashboard
              </span>
            </div>
            <div className="p-4 grid grid-cols-3 gap-3 text-[10px]">
              <div className="col-span-1 space-y-2">
                {[
                  ["Inbox", "12"],
                  ["Tâches", "8"],
                  ["Agenda", "5"],
                  ["Espaces", "4"],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between px-2 py-1.5 rounded"
                    style={{ backgroundColor: "#f1f5f9" }}
                  >
                    <span className="font-medium text-slate-700">{k}</span>
                    <span
                      className="px-1.5 rounded text-white text-[9px]"
                      style={{ backgroundColor: ACCENT }}
                    >
                      {v}
                    </span>
                  </div>
                ))}
              </div>
              <div className="col-span-2 space-y-2">
                <div
                  className="rounded p-2 text-white"
                  style={{ backgroundColor: NAVY }}
                >
                  <div className="font-semibold text-[11px]">
                    📬 5 emails prioritaires
                  </div>
                  <div className="opacity-80 mt-0.5">
                    RCP Cardio — demain 14h
                  </div>
                </div>
                <div className="rounded border border-slate-200 p-2">
                  <div className="font-semibold text-slate-700">
                    🗓 Réunion CNPCV
                  </div>
                  <div className="text-slate-500">Jeudi · 10:00 · Zoom</div>
                </div>
                <div className="rounded border border-slate-200 p-2">
                  <div className="font-semibold text-slate-700">
                    ✅ Publication Eur Heart J
                  </div>
                  <div className="text-slate-500">Échéance dans 4 jours</div>
                </div>
                <div className="rounded border border-slate-200 p-2">
                  <div className="font-semibold text-slate-700">
                    🤝 Espace UMCV
                  </div>
                  <div className="text-slate-500">3 nouveaux messages</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────  STATS  ───────────────────────── */
function Stats() {
  const items = [
    { v: "5", l: "sources emails unifiées" },
    { v: "3", l: "agendas synchronisés" },
    { v: "IA", l: "tri & analyse intégrés" },
    { v: "100%", l: "mode offline" },
    { v: "RGPD", l: "données sécurisées" },
  ];
  return (
    <section className="border-y border-slate-100 bg-slate-50/50">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 grid grid-cols-2 md:grid-cols-5 gap-6">
        {items.map((it) => (
          <div key={it.l} className="text-center">
            <div
              className="text-3xl font-bold"
              style={{
                color: NAVY,
                fontFamily: "Georgia, 'Times New Roman', serif",
              }}
            >
              {it.v}
            </div>
            <div className="text-xs text-slate-500 mt-1">{it.l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────  FEATURES  ───────────────────────── */
function Features() {
  const cards = [
    {
      icon: Mail,
      emoji: "📬",
      title: "Boîte mail unifiée",
      desc: "Centralisez CHU, université, Gmail, Outlook et votre messagerie pro en une seule vue intelligente. L'IA trie, classe et suggère des réponses.",
    },
    {
      icon: CheckSquare,
      emoji: "✅",
      title: "Gestion des tâches",
      desc: "Transformez vos emails en tâches. Vues Kanban et Gantt pour piloter tous vos projets médicaux, universitaires et de recherche.",
    },
    {
      icon: Calendar,
      emoji: "📅",
      title: "Agenda unifié",
      desc: "Google Calendar, iCloud et Outlook fusionnés. Détection automatique des réunions dans vos emails. Recherche de créneaux par IA.",
    },
    {
      icon: Users,
      emoji: "🤝",
      title: "Espaces collaboratifs",
      desc: "Créez des espaces de travail par projet (CNPCV, SFC, UMCV, Recherche…). Chat, documents partagés, sondages et gestion des groupes WhatsApp.",
    },
    {
      icon: MessageCircle,
      emoji: "📱",
      title: "Intégration WhatsApp",
      desc: "Recevez et analysez vos groupes WhatsApp professionnels directement dans le Hub. L'IA extrait automatiquement les actions et décisions.",
    },
    {
      icon: ShieldCheck,
      emoji: "🔒",
      title: "Sécurité & Conformité",
      desc: "Détection automatique des données de santé (HDS). Isolation des données sensibles. Conformité RGPD. Hébergement en Europe.",
    },
  ];

  return (
    <section id="features" className="py-20 md:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-xs uppercase tracking-widest font-semibold" style={{ color: ACCENT }}>
            Fonctionnalités
          </span>
          <h2
            className="mt-2 text-3xl md:text-4xl font-bold"
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              color: NAVY,
            }}
          >
            Un Hub complet pour votre quotidien
          </h2>
          <p className="mt-3 text-slate-600">
            Six modules intégrés pensés pour s'adapter aux exigences du milieu
            médical et académique.
          </p>
        </div>

        <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {cards.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.title}
                className="group rounded-xl border border-slate-200 bg-white p-6 hover:shadow-lg hover:-translate-y-0.5 transition"
              >
                <div
                  className="h-11 w-11 rounded-lg flex items-center justify-center text-white"
                  style={{ backgroundColor: NAVY }}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <h3
                  className="mt-4 text-lg font-semibold"
                  style={{
                    fontFamily: "Georgia, 'Times New Roman', serif",
                    color: NAVY,
                  }}
                >
                  {c.emoji} {c.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  {c.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────  AUDIENCES  ───────────────────────── */
function Audiences() {
  const profiles = [
    {
      icon: Hospital,
      emoji: "🏥",
      title: "Praticien hospitalier",
      desc: "Gérez vos communications CHU, vos gardes, vos RCP et vos patients sans quitter une seule interface.",
    },
    {
      icon: GraduationCap,
      emoji: "🎓",
      title: "Universitaire & Chercheur",
      desc: "Pilotez vos projets de recherche, vos publications, vos DU et vos collaborations internationales.",
    },
    {
      icon: Users2,
      emoji: "👥",
      title: "Responsable de société savante",
      desc: "Animez vos commissions, gérez vos membres, organisez vos congrès et diffusez vos communications.",
    },
  ];

  return (
    <section id="about" className="py-20 md:py-24" style={{ backgroundColor: "#f8fafc" }}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center max-w-2xl mx-auto">
          <h2
            className="text-3xl md:text-4xl font-bold"
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              color: NAVY,
            }}
          >
            Conçu pour les professionnels de santé exigeants
          </h2>
          <p className="mt-3 text-slate-600">
            Une plateforme qui s'adapte à vos missions, pas l'inverse.
          </p>
        </div>

        <div className="mt-12 grid md:grid-cols-3 gap-5">
          {profiles.map((p) => {
            const Icon = p.icon;
            return (
              <div
                key={p.title}
                className="rounded-xl bg-white p-7 border border-slate-200"
              >
                <div
                  className="h-12 w-12 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: "#eff6ff", color: NAVY }}
                >
                  <Icon className="h-6 w-6" />
                </div>
                <h3
                  className="mt-4 text-xl font-semibold"
                  style={{
                    fontFamily: "Georgia, 'Times New Roman', serif",
                    color: NAVY,
                  }}
                >
                  {p.emoji} {p.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  {p.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────  SECURITY  ───────────────────────── */
function Security() {
  const points = [
    { icon: Database, t: "Détection automatique HDS (données de santé)" },
    { icon: Lock, t: "Isolation locale des données sensibles" },
    { icon: ShieldCheck, t: "Chiffrement AES-256" },
    { icon: Globe, t: "Hébergement en Europe (RGPD)" },
    { icon: FileCheck2, t: "Aucune donnée patient stockée en clair" },
    { icon: Sparkles, t: "Audit log complet et traçable" },
  ];
  return (
    <section id="security" className="py-20 md:py-24 text-white" style={{ backgroundColor: NAVY }}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <span
            className="text-xs uppercase tracking-widest font-semibold"
            style={{ color: "#93c5fd" }}
          >
            Sécurité
          </span>
          <h2
            className="mt-2 text-3xl md:text-4xl font-bold leading-tight"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          >
            Vos données médicales en sécurité
          </h2>
          <p className="mt-4 text-slate-300 leading-relaxed">
            MyHub Pro applique les meilleures pratiques de l'industrie : tout
            est pensé pour qu'aucune donnée patient n'échappe à votre contrôle.
          </p>
        </div>
        <div className="space-y-3">
          {points.map((p) => {
            const Icon = p.icon;
            return (
              <div
                key={p.t}
                className="flex items-start gap-3 rounded-lg p-3"
                style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
              >
                <div
                  className="h-9 w-9 rounded-md flex items-center justify-center shrink-0"
                  style={{ backgroundColor: ACCENT }}
                >
                  <Icon className="h-4 w-4 text-white" />
                </div>
                <p className="text-sm pt-1.5">{p.t}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────  INTEGRATIONS  ───────────────────────── */
function Integrations() {
  const tools = [
    "Gmail",
    "Outlook",
    "Google Calendar",
    "iCloud",
    "OneDrive",
    "OneNote",
    "Zoom",
    "WhatsApp Business",
  ];
  return (
    <section className="py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 text-center">
        <h2
          className="text-2xl md:text-3xl font-bold"
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            color: NAVY,
          }}
        >
          S'intègre avec vos outils existants
        </h2>
        <p className="mt-3 text-slate-600">
          Pas de migration : MyHub Pro se branche sur ce que vous utilisez déjà.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2.5">
          {tools.map((t) => (
            <span
              key={t}
              className="text-sm font-medium px-4 py-2 rounded-full border bg-white"
              style={{ borderColor: "#e2e8f0", color: NAVY }}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────  TESTIMONIAL  ───────────────────────── */
function Testimonial() {
  return (
    <section className="py-20" style={{ backgroundColor: "#f8fafc" }}>
      <div className="mx-auto max-w-3xl px-4 sm:px-6 text-center">
        <div
          className="text-5xl leading-none"
          style={{ color: ACCENT, fontFamily: "Georgia, serif" }}
        >
          “
        </div>
        <blockquote
          className="mt-2 text-xl md:text-2xl italic leading-relaxed"
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            color: NAVY,
          }}
        >
          MyHub Pro a transformé ma façon de travailler. Je gère maintenant mes
          emails CHU, mes projets de recherche et mes réunions SFC depuis une
          seule interface.
        </blockquote>
        <div className="mt-5 text-sm font-medium text-slate-600">
          — Dr S. Lafitte, Cardiologue, CHU Bordeaux
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────  CONTACT FORM  ───────────────────────── */
function ContactForm() {
  const [first_name, setFirst] = useState("");
  const [last_name, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [institution, setInstitution] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!first_name.trim() || !last_name.trim() || !email.trim()) {
      toast.error("Merci de remplir les champs obligatoires");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/public/landing-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: first_name.trim(),
          last_name: last_name.trim(),
          email: email.trim(),
          institution: institution.trim(),
          specialty: specialty.trim(),
          message: message.trim(),
          website,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Erreur");
      }
      setSubmitted(true);
      toast.success("Demande envoyée !");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Envoi impossible, réessayez",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="contact" className="py-20 md:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="text-center">
          <span className="text-xs uppercase tracking-widest font-semibold" style={{ color: ACCENT }}>
            Demande d'accès
          </span>
          <h2
            className="mt-2 text-3xl md:text-4xl font-bold"
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              color: NAVY,
            }}
          >
            Intéressé ? Demandez un accès
          </h2>
          <p className="mt-3 text-slate-600">
            MyHub Pro est en accès anticipé pour les professionnels de santé.
            Décrivez brièvement votre contexte, nous reviendrons vers vous
            rapidement.
          </p>
        </div>

        <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 md:p-8 shadow-sm">
          {submitted ? (
            <div className="text-center py-10">
              <div
                className="inline-flex h-14 w-14 rounded-full items-center justify-center text-white text-2xl"
                style={{ backgroundColor: ACCENT }}
              >
                ✓
              </div>
              <h3
                className="mt-4 text-xl font-semibold"
                style={{
                  fontFamily: "Georgia, 'Times New Roman', serif",
                  color: NAVY,
                }}
              >
                Merci ! Nous vous contacterons sous 48h.
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                Votre demande a bien été enregistrée.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <Field
                  label="Prénom *"
                  value={first_name}
                  onChange={setFirst}
                  required
                  autoComplete="given-name"
                />
                <Field
                  label="Nom *"
                  value={last_name}
                  onChange={setLast}
                  required
                  autoComplete="family-name"
                />
              </div>
              <Field
                label="Email professionnel *"
                type="email"
                value={email}
                onChange={setEmail}
                required
                autoComplete="email"
              />
              <div className="grid md:grid-cols-2 gap-4">
                <Field
                  label="Établissement / Institution"
                  value={institution}
                  onChange={setInstitution}
                  placeholder="CHU de Bordeaux, INSERM…"
                />
                <Field
                  label="Spécialité / Fonction"
                  value={specialty}
                  onChange={setSpecialty}
                  placeholder="Cardiologie, PU-PH, Chef de service…"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Message (optionnel)
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Décrivez brièvement votre contexte et vos besoins…"
                />
              </div>

              {/* honeypot */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="hidden"
                aria-hidden="true"
              />

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-md text-white font-semibold shadow-sm hover:opacity-90 transition disabled:opacity-60"
                style={{ backgroundColor: NAVY }}
              >
                {submitting ? "Envoi…" : "Envoyer ma demande"}
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </button>

              <p className="text-xs text-slate-500 text-center">
                En soumettant ce formulaire, vous acceptez notre{" "}
                <Link
                  to="/privacy"
                  className="underline hover:text-slate-700"
                >
                  politique de confidentialité
                </Link>
                .
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
      </label>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        maxLength={255}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
    </div>
  );
}

/* ─────────────────────────  FOOTER  ───────────────────────── */
function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12 grid md:grid-cols-3 gap-8 text-sm">
        <div>
          <div className="flex items-center gap-2">
            <div
              className="h-9 w-9 rounded-md flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: NAVY }}
            >
              M
            </div>
            <span
              className="text-lg font-semibold"
              style={{
                fontFamily: "Georgia, 'Times New Roman', serif",
                color: NAVY,
              }}
            >
              MyHub <span style={{ color: ACCENT }}>Pro</span>
            </span>
          </div>
          <p className="mt-3 text-slate-600 text-xs leading-relaxed">
            MyHub Pro — Conçu par et pour les professionnels de santé.
          </p>
        </div>

        <div>
          <div
            className="text-xs uppercase tracking-widest font-semibold mb-3"
            style={{ color: NAVY }}
          >
            Légal
          </div>
          <ul className="space-y-2 text-slate-600">
            <li>
              <Link to="/mentions-legales" className="hover:text-slate-900">
                Mentions légales
              </Link>
            </li>
            <li>
              <Link to="/privacy" className="hover:text-slate-900">
                Politique de confidentialité
              </Link>
            </li>
            <li>
              <a href="#contact" className="hover:text-slate-900">
                Contact
              </a>
            </li>
          </ul>
        </div>

        <div>
          <div
            className="text-xs uppercase tracking-widest font-semibold mb-3"
            style={{ color: NAVY }}
          >
            Contact
          </div>
          <a
            href="mailto:chu@myhub-pro.fr"
            className="text-slate-600 hover:text-slate-900"
          >
            chu@myhub-pro.fr
          </a>
          <p className="text-slate-500 text-xs mt-3">Bordeaux, France</p>
        </div>
      </div>

      <div className="border-t border-slate-100">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-5 text-xs text-slate-500 flex flex-col md:flex-row items-center justify-between gap-2">
          <span>© 2026 MyHub Pro — Bordeaux, France</span>
          <span>Hébergement Europe • Conforme RGPD</span>
        </div>
      </div>
    </footer>
  );
}
