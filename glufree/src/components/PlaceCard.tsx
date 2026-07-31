"use client";

import { MapPin, Star, Phone, Globe, Navigation } from "lucide-react";
import ShareButton from "@/components/ShareButton";
import type { Place } from "@/lib/types";
import { LevelBadge, VerificationBadge, FeaturedBadge } from "./VerifiedBadge";
import { distanceKm, formatDistance } from "@/lib/geo";
import { useTranslation } from "@/lib/i18n/LanguageProvider";

interface PlaceCardProps {
  place: Place;
  active?: boolean;
  userPosition?: [number, number] | null;
  onClick?: () => void;
  detailed?: boolean;
}

export default function PlaceCard({
  place,
  active = false,
  userPosition,
  onClick,
  detailed = false,
}: PlaceCardProps) {
  const { t } = useTranslation();
  const distance = userPosition
    ? formatDistance(distanceKm(userPosition[0], userPosition[1], place.lat, place.lng))
    : null;

  return (
    <article
      className={`group rounded-2xl border bg-white p-4 shadow-card transition-all duration-200 ${
        active
          ? "border-primary ring-2 ring-primary/30"
          : place.featured
            ? "border-amber-300 ring-1 ring-amber-200"
            : "border-line hover:border-primary/40"
      } ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      tabIndex={onClick ? 0 : undefined}
      role={onClick ? "button" : undefined}
      aria-pressed={onClick ? active : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">
            {t.categories[place.category]}
            {place.source === "google" && (
              <span className="ml-2 font-semibold normal-case tracking-normal text-slate-400">
                {t.card.viaGoogle}
              </span>
            )}
          </p>
          <h3 className="mt-0.5 truncate font-display text-lg font-bold text-ink">
            {place.name}
          </h3>
        </div>
        {place.rating > 0 && (
          <span className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-sm font-bold text-amber-700">
            <Star className="h-4 w-4 fill-amber-500 text-amber-500" aria-hidden />
            {place.rating.toFixed(1)}
            <span className="font-medium text-amber-600/70">({place.reviews})</span>
          </span>
        )}
      </div>

      <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
        <MapPin className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <span className="truncate">
          {place.address}, {place.city}
          {place.country && place.country !== "Italia" ? ` · ${place.country}` : ""}
        </span>
        {distance && (
          <span className="ml-auto shrink-0 font-bold text-accent">{distance}</span>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {place.featured && <FeaturedBadge />}
        <LevelBadge level={place.glutenFreeLevel} />
        <VerificationBadge status={place.verification} />
      </div>

      {detailed && (
        <>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">{place.description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white transition-colors duration-200 hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              onClick={(e) => e.stopPropagation()}
            >
              <Navigation className="h-4 w-4" aria-hidden />
              {t.card.directions}
            </a>
            {place.phone && (
              <a
                href={`tel:${place.phone.replace(/\s/g, "")}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 py-2 text-sm font-bold text-ink transition-colors duration-200 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={(e) => e.stopPropagation()}
              >
                <Phone className="h-4 w-4" aria-hidden />
                {t.card.call}
              </a>
            )}
            {place.website && (
              <a
                href={place.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 py-2 text-sm font-bold text-ink transition-colors duration-200 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={(e) => e.stopPropagation()}
              >
                <Globe className="h-4 w-4" aria-hidden />
                {t.card.website}
              </a>
            )}
            <ShareButton
              title={`${place.name} · Glufree`}
              text={t.share.shareText(place.name, place.city, t.categories[place.category])}
              path={`/mappa?locale=${encodeURIComponent(place.id)}`}
            />
          </div>
        </>
      )}
    </article>
  );
}
