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
      openGraph: { title: `${title} | Glufree`, description },
    };
  }
  return {
    title: "Mappa",
    description:
      "Esplora la mappa interattiva dei locali gluten free: ristoranti, pizzerie, pasticcerie e gelaterie verificate in tutto il mondo.",
  };
}

export default function MapPage() {
  return (
    <Suspense>
      <MapExplorer />
    </Suspense>
  );
}
