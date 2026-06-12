import type { Metadata } from "next";
import MapExplorer from "@/components/map/MapExplorer";

export const metadata: Metadata = {
  title: "Mappa",
  description:
    "Esplora la mappa interattiva dei locali gluten free: ristoranti, pizzerie, pasticcerie e gelaterie verificate.",
};

export default function MapPage() {
  return <MapExplorer />;
}
