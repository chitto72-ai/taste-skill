import type { Place, PlaceCategory } from "./types";

/**
 * Integrazione con Google Places API (New) — Text Search.
 * Cerca luoghi "gluten free" nell'area richiesta e li normalizza nel
 * formato Place di Glufree. Attiva solo se GOOGLE_MAPS_API_KEY è impostata.
 */

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.primaryType",
  "places.websiteUri",
  "places.internationalPhoneNumber",
].join(",");

interface GoogleTextSearchPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  primaryType?: string;
  websiteUri?: string;
  internationalPhoneNumber?: string;
}

function mapCategory(primaryType?: string): PlaceCategory {
  if (!primaryType) return "ristorante";
  if (primaryType.includes("pizza")) return "pizzeria";
  if (primaryType.includes("bakery")) return "panetteria";
  if (primaryType.includes("ice_cream")) return "gelateria";
  if (primaryType.includes("cafe") || primaryType.includes("bar")) return "bar";
  if (primaryType.includes("dessert") || primaryType.includes("pastry")) return "pasticceria";
  return "ristorante";
}

function mapPriceLevel(level?: string): 1 | 2 | 3 | 4 {
  switch (level) {
    case "PRICE_LEVEL_INEXPENSIVE":
      return 1;
    case "PRICE_LEVEL_EXPENSIVE":
      return 3;
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return 4;
    default:
      return 2;
  }
}

export function isGoogleEnabled(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

export async function searchGoogleGlutenFree(options: {
  query?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
}): Promise<Place[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return [];

  const textQuery = options.query
    ? `${options.query} gluten free`
    : "ristorante gluten free";

  const body: Record<string, unknown> = {
    textQuery,
    languageCode: "it",
    maxResultCount: 20,
  };
  if (options.lat !== undefined && options.lng !== undefined) {
    body.locationBias = {
      circle: {
        center: { latitude: options.lat, longitude: options.lng },
        radius: options.radiusMeters ?? 15000,
      },
    };
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    console.error("Google Places error", res.status, await res.text());
    return [];
  }

  const data = (await res.json()) as { places?: GoogleTextSearchPlace[] };
  return (data.places ?? [])
    .filter((p) => p.location)
    .map((p): Place => {
      const addressParts = (p.formattedAddress ?? "").split(",").map((s) => s.trim());
      return {
        id: `google-${p.id}`,
        googlePlaceId: p.id,
        name: p.displayName?.text ?? "Locale senza nome",
        category: mapCategory(p.primaryType),
        glutenFreeLevel: "options",
        verification: "community",
        lat: p.location!.latitude,
        lng: p.location!.longitude,
        address: addressParts[0] ?? "",
        city: addressParts.length > 1 ? addressParts[1].replace(/^\d+\s*/, "") : "",
        rating: p.rating ?? 0,
        reviews: p.userRatingCount ?? 0,
        priceLevel: mapPriceLevel(p.priceLevel),
        description: "Risultato da Google Maps per la ricerca “gluten free”. Verifica sempre con il locale.",
        phone: p.internationalPhoneNumber,
        website: p.websiteUri,
        source: "google",
      };
    });
}
