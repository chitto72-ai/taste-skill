import type { Metadata, Viewport } from "next";
import { Playfair_Display, Karla } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import PwaRegister from "@/components/PwaRegister";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { ConsentProvider } from "@/components/ads/ConsentProvider";
import AdSenseLoader from "@/components/ads/AdSenseLoader";
import ConsentBanner from "@/components/ads/ConsentBanner";

const adsenseClientId =
  process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.startsWith("ca-pub-")
    ? process.env.NEXT_PUBLIC_ADSENSE_CLIENT
    : undefined;

const display = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700", "800"],
});

const body = Karla({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://glufree-app.netlify.app"
  ),
  title: {
    default: "Glufree — La mappa dei locali gluten free",
    template: "%s · Glufree",
  },
  description:
    "Trova ristoranti, pizzerie, pasticcerie e gelaterie senza glutine vicino a te. Mappa interattiva con locali verificati e certificati AIC.",
  applicationName: "Glufree",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Glufree",
  },
  keywords: [
    "gluten free",
    "senza glutine",
    "celiachia",
    "ristoranti gluten free",
    "mappa gluten free",
    "pizzeria senza glutine",
    "AIC",
    "dove mangiare senza glutine",
  ],
  openGraph: {
    title: "Glufree — La mappa dei locali gluten free",
    description:
      "La mappa interattiva dei luoghi dove mangiare senza glutine in sicurezza.",
    type: "website",
    locale: "it_IT",
    siteName: "Glufree",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Glufree — la mappa dei locali gluten free",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Glufree — La mappa dei locali gluten free",
    description:
      "Ristoranti, pizzerie e dolci senza glutine nel mondo, su una mappa interattiva.",
    images: ["/og-image.png"],
  },
  // Meta di verifica AdSense: consente a Google di validare il sito anche
  // prima che lo script (subordinato al consenso) venga caricato.
  ...(adsenseClientId ? { other: { "google-adsense-account": adsenseClientId } } : {}),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#EA580C",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh flex flex-col">
        {/* React solleva questi link nell'head: meno latenza al primo caricamento delle tile */}
        <link rel="preconnect" href="https://a.basemaps.cartocdn.com" />
        <link rel="preconnect" href="https://b.basemaps.cartocdn.com" />
        <link rel="preconnect" href="https://c.basemaps.cartocdn.com" />
        <LanguageProvider>
          <ConsentProvider>
            <Navbar />
            <main className="flex-1 flex flex-col">{children}</main>
            <AdSenseLoader />
            <ConsentBanner />
          </ConsentProvider>
        </LanguageProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
