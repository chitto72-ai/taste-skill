import type { Metadata } from "next";
import { Suspense } from "react";
import MapExplorer from "@/components/map/MapExplorer";
import seed from "@/data/seed-places.json";
import type { Place } from "@/lib/types";

interface MapPageProps {
  searchParams: Promise<{ locale?: string }>;
}

/** Anteprima social personalizzata quando si condivide un locale (?locale=id). */
export async function generateMetadata({ searchParams }: MapPageProps): Promise<Metadata> {
  const { locale } = await searchParams;
  const place = locale ? (seed as Place[]).find((p) => p.id === locale) : undefined;
  if (place) {
    const title = `${place.name} · ${place.city}`;
    const description = `${place.description} Trovato sulla mappa gluten free di Glufree.`;
    return {
      title,
      description,
      alternates: { canonical: `/mappa?locale=${encodeURIComponent(place.id)}` },
      openGraph: { title: `${title} | Glufree`, description },
    };
  }
  return {
    title: "Mappa",
    description:
      "Esplora la mappa interattiva dei locali gluten free: ristoranti, pizzerie, pasticcerie e gelaterie verificate in tutto il mondo.",
    alternates: { canonical: "/mappa" },
  };
}

const SCHEMA_TYPE: Record<Place["category"], string> = {
  ristorante: "Restaurant",
  pizzeria: "Restaurant",
  pasticceria: "Bakery",
  gelateria: "Restaurant",
  bar: "CafeOrCoffeeShop",
  panetteria: "Bakery",
};

/** JSON-LD per i rich result di Google quando si apre la scheda di un locale. */
function placeJsonLd(place: Place) {
  return {
    "@context": "https://schema.org",
    "@type": SCHEMA_TYPE[place.category],
    name: place.name,
    description: place.description,
    servesCuisine: "Gluten-free",
    address: {
      "@type": "PostalAddress",
      streetAddress: place.address,
      addressLocality: place.city,
      addressCountry: place.country ?? "Italia",
    },
    geo: { "@type": "GeoCoordinates", latitude: place.lat, longitude: place.lng },
    ...(place.rating
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: place.rating,
            reviewCount: place.reviews || 1,
          },
        }
      : {}),
    ...(place.website ? { url: place.website } : {}),
    ...(place.phone ? { telephone: place.phone } : {}),
  };
}

export default async function MapPage({ searchParams }: MapPageProps) {
  const { locale } = await searchParams;
  const place = locale ? (seed as Place[]).find((p) => p.id === locale) : undefined;

  return (
    <>
      {place && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(placeJsonLd(place)) }}
        />
      )}
      <Suspense>
        <MapExplorer />
      </Suspense>
    </>
  );
}
