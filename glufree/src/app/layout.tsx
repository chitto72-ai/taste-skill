import type { Metadata, Viewport } from "next";
import { Playfair_Display, Karla } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import PwaRegister from "@/components/PwaRegister";

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
  openGraph: {
    title: "Glufree — La mappa dei locali gluten free",
    description:
      "La mappa interattiva dei luoghi dove mangiare senza glutine in sicurezza.",
    type: "website",
    locale: "it_IT",
  },
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
        <Navbar />
        <main className="flex-1 flex flex-col">{children}</main>
        <PwaRegister />
      </body>
    </html>
  );
}
