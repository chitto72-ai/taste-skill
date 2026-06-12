import { promises as fs } from "fs";
import path from "path";
import type { OwnerSubmission, Place } from "./types";
import seed from "@/data/seed-places.json";

/**
 * Persistenza su file JSON: zero dipendenze esterne, pensata per demo e
 * self-hosting su un singolo nodo. Per il deploy serverless sostituire
 * con un database (vedi README).
 */
// Su Vercel/serverless il filesystem del progetto è in sola lettura: si scrive in /tmp
// (persistenza effimera, sufficiente per la demo; per produzione vedi README → database)
const DATA_DIR = process.env.VERCEL
  ? path.join("/tmp", "glufree-data")
  : path.join(process.cwd(), ".data");
const SUBMISSIONS_FILE = path.join(DATA_DIR, "submissions.json");
const APPROVED_FILE = path.join(DATA_DIR, "approved-places.json");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

export async function getSeedPlaces(): Promise<Place[]> {
  const approved = await readJson<Place[]>(APPROVED_FILE, []);
  return [...(seed as Place[]), ...approved];
}

export async function listSubmissions(): Promise<OwnerSubmission[]> {
  return readJson<OwnerSubmission[]>(SUBMISSIONS_FILE, []);
}

export async function saveSubmission(submission: OwnerSubmission): Promise<void> {
  const all = await listSubmissions();
  all.push(submission);
  await writeJson(SUBMISSIONS_FILE, all);
}

/** Coordinate dei capoluoghi: fallback quando manca la Geocoding API. */
const CITY_COORDS: Record<string, [number, number]> = {
  milano: [45.4642, 9.19],
  roma: [41.9028, 12.4964],
  torino: [45.0703, 7.6869],
  firenze: [43.7696, 11.2558],
  bologna: [44.4949, 11.3426],
  napoli: [40.8518, 14.2681],
  venezia: [45.4408, 12.3155],
  palermo: [38.1157, 13.3615],
  bari: [41.1171, 16.8719],
  genova: [44.4056, 8.9463],
  verona: [45.4384, 10.9916],
  padova: [45.4064, 11.8768],
  cagliari: [39.2238, 9.1217],
  catania: [37.5079, 15.083],
  trieste: [45.6495, 13.7768],
};

async function geocode(address: string, city: string): Promise<[number, number] | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (apiKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        `${address}, ${city}, Italia`
      )}&key=${apiKey}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as {
          results?: { geometry: { location: { lat: number; lng: number } } }[];
        };
        const loc = data.results?.[0]?.geometry.location;
        if (loc) return [loc.lat, loc.lng];
      }
    } catch {
      /* si passa al fallback per città */
    }
  }
  return CITY_COORDS[city.trim().toLowerCase()] ?? null;
}

/** Approva una richiesta: il locale entra in mappa con badge "verificato". */
export async function approveSubmission(id: string): Promise<Place | null> {
  const all = await listSubmissions();
  const sub = all.find((s) => s.id === id);
  if (!sub || sub.status === "approved") return null;

  sub.status = "approved";
  await writeJson(SUBMISSIONS_FILE, all);

  const coords =
    sub.business.lat !== undefined && sub.business.lng !== undefined
      ? ([sub.business.lat, sub.business.lng] as [number, number])
      : await geocode(sub.business.address, sub.business.city);

  const place: Place = {
    id: `owner-${sub.id}`,
    name: sub.business.name,
    category: sub.business.category,
    glutenFreeLevel: sub.business.glutenFreeLevel,
    verification: "verified",
    // Ultimo fallback: centro Italia, in attesa di coordinate precise
    lat: coords?.[0] ?? 42.5,
    lng: coords?.[1] ?? 12.5,
    address: sub.business.address,
    city: sub.business.city,
    rating: 0,
    reviews: 0,
    priceLevel: 2,
    description: sub.business.description,
    phone: sub.business.phone,
    website: sub.business.website,
    source: "glufree",
  };
  const approved = await readJson<Place[]>(APPROVED_FILE, []);
  approved.push(place);
  await writeJson(APPROVED_FILE, approved);
  return place;
}
