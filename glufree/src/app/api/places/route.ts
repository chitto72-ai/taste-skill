import { NextRequest, NextResponse } from "next/server";
import { getSeedPlaces } from "@/lib/store";
import { isGoogleEnabled, searchGoogleGlutenFree } from "@/lib/google";
import { distanceKm } from "@/lib/geo";
import type { Place } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/places?q=...&lat=...&lng=...&category=...&level=...
 * Unisce il database Glufree (locali verificati + dataset demo) con i
 * risultati live di Google Maps quando la chiave API è configurata.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q")?.trim().toLowerCase() ?? "";
  const lat = searchParams.get("lat") ? Number(searchParams.get("lat")) : undefined;
  const lng = searchParams.get("lng") ? Number(searchParams.get("lng")) : undefined;
  const category = searchParams.get("category") ?? "";
  const level = searchParams.get("level") ?? "";

  let places: Place[] = await getSeedPlaces();

  if (isGoogleEnabled()) {
    const googlePlaces = await searchGoogleGlutenFree({ query: q || undefined, lat, lng });
    const known = new Set(places.map((p) => p.googlePlaceId).filter(Boolean));
    places = [...places, ...googlePlaces.filter((p) => !known.has(p.googlePlaceId))];
  }

  if (q) {
    places = places.filter((p) =>
      [p.name, p.city, p.country ?? "", p.address, p.description, p.category]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }
  if (category) {
    places = places.filter((p) => p.category === category);
  }
  if (level) {
    places = places.filter((p) => p.glutenFreeLevel === level);
  }

  const hasLocation = lat !== undefined && lng !== undefined;
  const withDistance = places.map((p) =>
    hasLocation ? { ...p, distanceKm: distanceKm(lat!, lng!, p.lat, p.lng) } : p
  );

  // I locali "In evidenza" (inserzioni a pagamento) vengono mostrati per primi;
  // a parità di stato si ordina per distanza quando è nota la posizione utente.
  withDistance.sort((a, b) => {
    const fa = a.featured ? 1 : 0;
    const fb = b.featured ? 1 : 0;
    if (fa !== fb) return fb - fa;
    if (hasLocation) {
      const da = (a as { distanceKm: number }).distanceKm;
      const db = (b as { distanceKm: number }).distanceKm;
      return da - db;
    }
    return 0;
  });
  places = withDistance;

  return NextResponse.json({
    places,
    googleEnabled: isGoogleEnabled(),
    count: places.length,
  });
}
