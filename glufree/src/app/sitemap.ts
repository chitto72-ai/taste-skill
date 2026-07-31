import type { MetadataRoute } from "next";
import seed from "@/data/seed-places.json";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://glufree-app.netlify.app";

/** Sitemap: pagine principali + un deep link per ogni locale (indicizzabili da Google). */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/mappa`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/registra-locale`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
  ];

  const placePages: MetadataRoute.Sitemap = (seed as { id: string }[]).map((p) => ({
    url: `${BASE}/mappa?locale=${encodeURIComponent(p.id)}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticPages, ...placePages];
}
