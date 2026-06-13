import Link from "next/link";
import {
  Map,
  ShieldCheck,
  BadgeCheck,
  Store,
  Search,
  Navigation,
  Users,
  ArrowRight,
  MapPin,
  Star,
} from "lucide-react";
import seed from "@/data/seed-places.json";
import { InviteActions } from "@/components/ShareButton";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://glufree-app.netlify.app";

const orgJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Glufree",
  url: BASE,
  description:
    "La mappa interattiva dei locali gluten free nel mondo: ristoranti, pizzerie, pasticcerie e gelaterie verificate.",
  logo: `${BASE}/icons/icon-512.png`,
};

const siteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Glufree",
  url: BASE,
  potentialAction: {
    "@type": "SearchAction",
    target: { "@type": "EntryPoint", urlTemplate: `${BASE}/mappa?q={search_term_string}` },
    "query-input": "required name=search_term_string",
  },
};

const stats = [
  { value: String(seed.length) + "+", label: "Locali in mappa" },
  { value: String(new Set(seed.map((p) => p.city)).size), label: "Città nel mondo" },
  {
    value: String(new Set(seed.map((p) => (p as { country?: string }).country ?? "Italia")).size),
    label: "Paesi",
  },
];

const steps = [
  {
    icon: Search,
    title: "Cerca",
    text: "Scrivi una città, un piatto o il nome di un locale. Oppure usa la tua posizione per scoprire cosa c'è vicino a te.",
  },
  {
    icon: ShieldCheck,
    title: "Scegli in sicurezza",
    text: "Ogni locale mostra il livello gluten free: cucina 100% dedicata, certificazione AIC o menu senza glutine dedicato.",
  },
  {
    icon: Navigation,
    title: "Vai a colpo sicuro",
    text: "Indicazioni stradali, telefono e sito web a portata di tap. Niente più telefonate di verifica prima di uscire.",
  },
];

const badges = [
  {
    icon: ShieldCheck,
    color: "text-safe bg-safe-light",
    title: "100% Gluten Free",
    text: "Cucina e laboratorio interamente senza glutine: rischio contaminazione azzerato.",
  },
  {
    icon: BadgeCheck,
    color: "text-accent bg-blue-50",
    title: "Certificato AIC",
    text: "Locale inserito nel programma Alimentazione Fuori Casa dell'Associazione Italiana Celiachia.",
  },
  {
    icon: Users,
    color: "text-primary-dark bg-orange-100",
    title: "Verificato Glufree",
    text: "Il titolare ha inviato la documentazione (P.IVA + certificazioni) e il nostro team l'ha controllata.",
  },
];

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
      />
      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-primary/10 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -left-32 top-48 h-80 w-80 rounded-full bg-accent/10 blur-3xl"
          aria-hidden
        />
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-24">
          <div className="animate-fade-up">
            <p className="inline-flex items-center gap-2 rounded-full bg-safe-light px-4 py-1.5 text-sm font-bold text-safe">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Mangiare fuori senza pensieri
            </p>
            <h1 className="mt-6 font-display text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-5xl lg:text-6xl">
              Tutti i locali{" "}
              <span className="relative whitespace-nowrap text-primary">
                gluten free
                <svg
                  className="absolute -bottom-1 left-0 w-full"
                  viewBox="0 0 200 9"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M2 7c40-5 120-5 196-2"
                    stroke="#F97316"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              , su una sola mappa.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
              Ristoranti, pizzerie, pasticcerie e gelaterie senza glutine, con
              livello di sicurezza chiaro e locali verificati uno a uno. I dati
              di Google Maps, il design e le verifiche di Glufree.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/mappa"
                className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-base font-bold text-white shadow-pin transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <Map className="h-5 w-5" aria-hidden />
                Apri la mappa
              </Link>
              <Link
                href="/registra-locale"
                className="inline-flex min-h-12 items-center gap-2 rounded-2xl border-2 border-ink bg-white px-6 py-3 text-base font-bold text-ink transition-all duration-200 hover:-translate-y-0.5 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Store className="h-5 w-5" aria-hidden />
                Aggiungi il tuo locale
              </Link>
            </div>

            <dl className="mt-12 grid grid-cols-3 gap-4">
              {stats.map((s) => (
                <div key={s.label} className="rounded-2xl border border-line bg-white p-4 shadow-card">
                  <dt className="order-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {s.label}
                  </dt>
                  <dd className="font-display text-3xl font-extrabold text-primary">
                    {s.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Anteprima stilizzata della mappa */}
          <div className="relative animate-fade-up [animation-delay:150ms]">
            <div className="relative mx-auto aspect-[4/5] max-w-md overflow-hidden rounded-[2rem] border-8 border-ink bg-[#f6efe6] shadow-2xl">
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 500" aria-hidden>
                <path d="M-20 120 C 80 100, 180 160, 420 130" stroke="#fff" strokeWidth="14" fill="none" />
                <path d="M-20 260 C 120 240, 240 300, 420 270" stroke="#fff" strokeWidth="10" fill="none" />
                <path d="M120 -20 C 140 120, 100 320, 140 520" stroke="#fff" strokeWidth="12" fill="none" />
                <path d="M280 -20 C 260 140, 300 340, 270 520" stroke="#fff" strokeWidth="8" fill="none" />
                <circle cx="320" cy="80" r="36" fill="#d9ead3" />
                <circle cx="60" cy="380" r="48" fill="#d9ead3" />
                <rect x="180" y="330" width="70" height="50" rx="8" fill="#fde8d7" />
                <rect x="60" y="160" width="56" height="42" rx="8" fill="#fde8d7" />
              </svg>
              <div className="absolute left-[22%] top-[28%] animate-pulse-soft">
                <HeroPin color="#059669" />
              </div>
              <div className="absolute left-[60%] top-[48%] animate-pulse-soft [animation-delay:600ms]">
                <HeroPin color="#EA580C" />
              </div>
              <div className="absolute left-[38%] top-[66%] animate-pulse-soft [animation-delay:1200ms]">
                <HeroPin color="#2563EB" />
              </div>
              {/* Mini card flottante */}
              <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-line bg-white/95 p-3 shadow-card backdrop-blur">
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  Ristorante
                </p>
                <p className="font-display text-sm font-bold text-ink">Mama Eat · Milano</p>
                <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-slate-500">
                  <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" aria-hidden />
                  4.5 ·
                  <span className="inline-flex items-center gap-0.5 text-safe">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> 100% Gluten Free
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Come funziona ---------- */}
      <section className="bg-white py-16 lg:py-24" aria-labelledby="come-funziona">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <h2
            id="come-funziona"
            className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl"
          >
            Dalla ricerca alla tavola, <span className="text-primary">senza ansia</span>.
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {steps.map((step, i) => (
              <div
                key={step.title}
                className="group relative rounded-3xl border border-line bg-cream p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-card"
              >
                <span className="absolute right-6 top-6 font-display text-5xl font-extrabold text-primary/10">
                  {i + 1}
                </span>
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary text-white shadow-pin">
                  <step.icon className="h-7 w-7" aria-hidden />
                </span>
                <h3 className="mt-6 font-display text-xl font-bold text-ink">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-slate-600">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- I badge di sicurezza ---------- */}
      <section className="py-16 lg:py-24" aria-labelledby="badge-sicurezza">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <h2
            id="badge-sicurezza"
            className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl"
          >
            Sai sempre <span className="text-safe">quanto è sicuro</span> un locale.
          </h2>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            Niente recensioni vaghe: ogni locale ha un badge chiaro che indica il
            livello di protezione per chi è celiaco o sensibile al glutine.
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {badges.map((badge) => (
              <div key={badge.title} className="rounded-3xl border border-line bg-white p-8 shadow-card">
                <span className={`grid h-14 w-14 place-items-center rounded-2xl ${badge.color}`}>
                  <badge.icon className="h-7 w-7" aria-hidden />
                </span>
                <h3 className="mt-6 font-display text-xl font-bold text-ink">{badge.title}</h3>
                <p className="mt-2 leading-relaxed text-slate-600">{badge.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Passaparola / inviti ---------- */}
      <section className="bg-white py-16 lg:py-24" aria-labelledby="passaparola">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <h2
            id="passaparola"
            className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl"
          >
            Più siamo, <span className="text-primary">più è sicuro</span> per tutti.
          </h2>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            Glufree cresce con il passaparola: invita chi mangia senza glutine e i
            locali che meritano di essere sulla mappa.
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <div className="rounded-3xl border border-line bg-cream p-8">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary text-white shadow-pin">
                <Users className="h-7 w-7" aria-hidden />
              </span>
              <h3 className="mt-6 font-display text-xl font-bold text-ink">
                Invita un amico celiaco
              </h3>
              <p className="mb-6 mt-2 leading-relaxed text-slate-600">
                Condividi la mappa con chi è sempre in cerca di un posto sicuro
                dove mangiare.
              </p>
              <InviteActions
                message="Ho trovato Glufree: la mappa dei locali gluten free verificati, anche vicino a te! 🌾🚫"
                path="/mappa?invito=amico"
                emailSubject="Ti consiglio Glufree: la mappa dei locali gluten free"
              />
            </div>
            <div className="rounded-3xl border border-line bg-cream p-8">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-safe text-white">
                <Store className="h-7 w-7" aria-hidden />
              </span>
              <h3 className="mt-6 font-display text-xl font-bold text-ink">
                Invita il tuo locale preferito
              </h3>
              <p className="mb-6 mt-2 leading-relaxed text-slate-600">
                Conosci un ristorante gluten free che non è in mappa? Mandagli
                l&apos;invito: la registrazione è gratuita.
              </p>
              <InviteActions
                message="Il tuo locale merita di essere su Glufree, la mappa dei ristoranti gluten free: registrati gratis e ottieni il badge verificato. 🌾🚫"
                path="/registra-locale?invito=cliente"
                emailSubject="Porta il tuo locale sulla mappa gluten free di Glufree"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ---------- CTA ristoratori ---------- */}
      <section className="bg-ink py-16 lg:py-24" aria-labelledby="cta-ristoratori">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-8 px-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-bold text-orange-300">
              <Store className="h-4 w-4" aria-hidden />
              Per i ristoratori
            </p>
            <h2
              id="cta-ristoratori"
              className="mt-6 font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl"
            >
              Hai un locale gluten free? Fatti trovare da chi ti sta cercando.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-300">
              Registra il tuo locale, invia la documentazione (Partita IVA e
              certificazione gluten free) e ottieni il badge{" "}
              <span className="font-bold text-emerald-400">Verificato Glufree</span>:
              in mappa, gratis, davanti a migliaia di persone celiache.
            </p>
          </div>
          <Link
            href="/registra-locale"
            className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-2xl bg-primary px-8 py-4 text-base font-bold text-white shadow-pin transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Inizia la verifica
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="border-t border-line bg-cream py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <p className="flex items-center gap-2 font-display text-lg font-bold text-ink">
            <MapPin className="h-5 w-5 text-primary" aria-hidden />
            Glufree
          </p>
          <p className="text-sm text-slate-500">
            Verifica sempre direttamente con il locale in caso di celiachia severa.
          </p>
        </div>
      </footer>
    </>
  );
}

function HeroPin({ color }: { color: string }) {
  return (
    <svg width="34" height="44" viewBox="0 0 36 46" aria-hidden>
      <path
        d="M18 1C9.2 1 2 8.2 2 17c0 11.5 13.2 25.6 14.7 27.2a1.8 1.8 0 0 0 2.6 0C20.8 42.6 34 28.5 34 17 34 8.2 26.8 1 18 1z"
        fill={color}
        stroke="#fff"
        strokeWidth="2"
      />
      <circle cx="18" cy="17" r="7.5" fill="#fff" />
      <path
        d="M14.5 17.5l2.4 2.4 4.6-4.8"
        stroke={color}
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
