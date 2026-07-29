"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  LocateFixed,
  Loader2,
  X,
  List,
  Map as MapIcon,
  SlidersHorizontal,
} from "lucide-react";
import type { Place } from "@/lib/types";
import PlaceCard from "@/components/PlaceCard";
import AdSlot from "@/components/ads/AdSlot";
import { AD_SLOTS } from "@/lib/ads";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import type { Dict } from "@/lib/i18n/dictionaries";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-muted">
      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
    </div>
  ),
});

function categoryFilters(t: Dict) {
  return [
    { value: "", label: t.categoriesFilter.all },
    { value: "ristorante", label: t.categoriesFilter.ristorante },
    { value: "pizzeria", label: t.categoriesFilter.pizzeria },
    { value: "pasticceria", label: t.categoriesFilter.pasticceria },
    { value: "gelateria", label: t.categoriesFilter.gelateria },
    { value: "panetteria", label: t.categoriesFilter.panetteria },
    { value: "bar", label: t.categoriesFilter.bar },
  ];
}

function levelFilters(t: Dict) {
  return [
    { value: "", label: t.levelsFilter.any },
    { value: "dedicated", label: t.levelsFilter.dedicated },
    { value: "certified", label: t.levelsFilter.certified },
    { value: "options", label: t.levelsFilter.options },
  ];
}

export default function MapExplorer() {
  // Ricerca iniziale da ?q= (link condivisi e SearchAction di Google)
  const initialQuery = useSearchParams().get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState("");
  const [level, setLevel] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { t } = useTranslation();
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // La vista parte centrata sull'Italia; si adatta ai risultati dopo una ricerca
  // (subito, se si arriva con un termine di ricerca nell'URL)
  const [fitResults, setFitResults] = useState(Boolean(initialQuery));
  const abortRef = useRef<AbortController | null>(null);

  // Deep link: /mappa?locale=<id> apre direttamente la scheda del locale condiviso
  const searchParams = useSearchParams();
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || places.length === 0) return;
    const shared = searchParams.get("locale");
    if (!shared) {
      deepLinkHandled.current = true;
      return;
    }
    if (places.some((p) => p.id === shared)) {
      setSelectedId(shared);
      deepLinkHandled.current = true;
    }
  }, [places, searchParams]);

  const fetchPlaces = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (category) params.set("category", category);
      if (level) params.set("level", level);
      if (userPosition) {
        params.set("lat", String(userPosition[0]));
        params.set("lng", String(userPosition[1]));
      }
      const res = await fetch(`/api/places?${params}`, { signal: controller.signal });
      const data = (await res.json()) as { places: Place[] };
      setPlaces(data.places);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error(err);
      }
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [query, category, level, userPosition]);

  // Ricerca con debounce per non martellare l'API a ogni tasto
  useEffect(() => {
    const t = setTimeout(fetchPlaces, query ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchPlaces, query]);

  const locateMe = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPosition([pos.coords.latitude, pos.coords.longitude]);
        setFitResults(false);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const selected = useMemo(
    () => places.find((p) => p.id === selectedId) ?? null,
    [places, selectedId]
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setFitResults(false);
    setMobileView("map");
  }, []);

  const activeFilters = (category ? 1 : 0) + (level ? 1 : 0);

  return (
    <div className="relative flex h-[calc(100dvh-4rem)] w-full overflow-hidden">
      {/* ---------- Pannello lista (desktop) ---------- */}
      <aside
        className="hidden w-[400px] shrink-0 flex-col border-r border-line bg-cream lg:flex"
        aria-label={t.map.listAria}
      >
        <div className="border-b border-line p-4">
          <SearchControls
            query={query}
            setQuery={setQuery}
            category={category}
            setCategory={setCategory}
            level={level}
            setLevel={setLevel}
            onFiltersChanged={() => setFitResults(true)}
          />
        </div>
        <div className="thin-scroll flex-1 space-y-3 overflow-y-auto p-4" role="list">
          <ResultsHeader loading={loading} count={places.length} />
          {places.map((place, i) => (
            <div key={place.id}>
              <motion.div
                role="listitem"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(i * 0.035, 0.4) }}
              >
                <PlaceCard
                  place={place}
                  active={place.id === selectedId}
                  userPosition={userPosition}
                  onClick={() => handleSelect(place.id)}
                />
              </motion.div>
              {i === 3 && <AdSlot slot={AD_SLOTS.list} />}
            </div>
          ))}
          {!loading && places.length === 0 && <EmptyState onReset={() => { setQuery(""); setCategory(""); setLevel(""); }} />}
        </div>
      </aside>

      {/* ---------- Mappa ---------- */}
      <div className="relative flex-1">
        <MapView
          places={places}
          selectedId={selectedId}
          onSelect={handleSelect}
          userPosition={userPosition}
          fitResults={fitResults}
        />

        {/* Barra di ricerca flottante (mobile/tablet) */}
        <div className="absolute inset-x-3 top-3 z-[1000] lg:hidden">
          <SearchControls
            query={query}
            setQuery={setQuery}
            category={category}
            setCategory={setCategory}
            level={level}
            setLevel={setLevel}
            compact
            filtersOpen={filtersOpen}
            setFiltersOpen={setFiltersOpen}
            activeFilters={activeFilters}
            onFiltersChanged={() => setFitResults(true)}
          />
        </div>

        {/* Pulsante geolocalizzazione */}
        <button
          type="button"
          onClick={locateMe}
          aria-label={t.map.locateAria}
          className="absolute bottom-24 right-4 z-[1000] grid h-12 w-12 cursor-pointer place-items-center rounded-2xl bg-white text-accent shadow-card transition-transform duration-200 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:bottom-6"
        >
          {locating ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          ) : (
            <LocateFixed className="h-5 w-5" aria-hidden />
          )}
        </button>

        {/* Scheda dettaglio del locale selezionato */}
        <AnimatePresence>
          {selected && (
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24, transition: { duration: 0.18 } }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="absolute inset-x-3 bottom-3 z-[1000] mx-auto max-w-md lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-[380px]"
            >
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label={t.map.closeCardAria}
                  className="absolute -right-2 -top-2 z-10 grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-ink text-white shadow-card transition-transform duration-200 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
                <PlaceCard place={selected} userPosition={userPosition} detailed />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Toggle mappa/lista (mobile) */}
        <button
          type="button"
          onClick={() => setMobileView(mobileView === "map" ? "list" : "map")}
          className="absolute bottom-6 left-1/2 z-[1000] flex min-h-12 -translate-x-1/2 cursor-pointer items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white shadow-card transition-transform duration-200 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
        >
          {mobileView === "map" ? (
            <>
              <List className="h-4 w-4" aria-hidden /> {t.map.seeList}
            </>
          ) : (
            <>
              <MapIcon className="h-4 w-4" aria-hidden /> {t.map.seeMap}
            </>
          )}
        </button>

        {/* Pannello lista a tutto schermo (mobile) */}
        <AnimatePresence>
          {mobileView === "list" && (
            <motion.div
              initial={{ opacity: 0, y: 48 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 48, transition: { duration: 0.2 } }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="thin-scroll absolute inset-0 z-[990] space-y-3 overflow-y-auto bg-cream p-4 pt-32 pb-24 lg:hidden"
              role="list"
              aria-label={t.map.listAria}
            >
              <ResultsHeader loading={loading} count={places.length} />
              {places.map((place, i) => (
                <div key={place.id}>
                  <div role="listitem">
                    <PlaceCard
                      place={place}
                      active={place.id === selectedId}
                      userPosition={userPosition}
                      onClick={() => handleSelect(place.id)}
                    />
                  </div>
                  {i === 3 && <AdSlot slot={AD_SLOTS.list} />}
                </div>
              ))}
              {!loading && places.length === 0 && <EmptyState onReset={() => { setQuery(""); setCategory(""); setLevel(""); }} />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------- Sottocomponenti ---------- */

function ResultsHeader({ loading, count }: { loading: boolean; count: number }) {
  const { t } = useTranslation();
  return (
    <p className="text-sm font-semibold text-slate-500" aria-live="polite">
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
          {t.map.searching}
        </span>
      ) : (
        <>
          <span className="font-display text-lg font-bold text-ink">{count}</span>{" "}
          {count === 1 ? t.map.resultOne : t.map.resultMany}
        </>
      )}
    </p>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white p-8 text-center">
      <p className="font-display text-lg font-bold text-ink">{t.map.emptyTitle}</p>
      <p className="mt-1 text-sm text-slate-500">{t.map.emptyText}</p>
      <button
        type="button"
        onClick={onReset}
        className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white transition-colors duration-200 hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        {t.map.emptyReset}
      </button>
    </div>
  );
}

interface SearchControlsProps {
  query: string;
  setQuery: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  level: string;
  setLevel: (v: string) => void;
  compact?: boolean;
  filtersOpen?: boolean;
  setFiltersOpen?: (v: boolean) => void;
  activeFilters?: number;
  onFiltersChanged?: () => void;
}

function SearchControls({
  query,
  setQuery,
  category,
  setCategory,
  level,
  setLevel,
  compact = false,
  filtersOpen = true,
  setFiltersOpen,
  activeFilters = 0,
  onFiltersChanged,
}: SearchControlsProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">{t.map.searchPlaceholder}</span>
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 rtl:left-auto rtl:right-3.5"
            aria-hidden
          />
          <input
            type="search"
            inputMode="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              onFiltersChanged?.();
            }}
            placeholder={t.map.searchPlaceholder}
            className="h-12 w-full rounded-2xl border border-line bg-white pl-11 pr-4 text-base shadow-card placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 rtl:pl-4 rtl:pr-11"
          />
        </label>
        {compact && setFiltersOpen && (
          <button
            type="button"
            onClick={() => setFiltersOpen(!filtersOpen)}
            aria-expanded={filtersOpen}
            aria-label={`${t.map.filtersAria}${activeFilters > 0 ? `, ${activeFilters} ${t.map.filtersActiveAria}` : ""}`}
            className="relative grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-2xl border border-line bg-white text-ink shadow-card transition-colors duration-200 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <SlidersHorizontal className="h-5 w-5" aria-hidden />
            {activeFilters > 0 && (
              <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-[11px] font-bold text-white">
                {activeFilters}
              </span>
            )}
          </button>
        )}
      </div>

      {(!compact || filtersOpen) && (
        <div className={compact ? "rounded-2xl border border-line bg-white p-3 shadow-card" : ""}>
          <FilterChips
            label={t.map.filtersCategory}
            options={categoryFilters(t)}
            value={category}
            onChange={(v) => {
              setCategory(v);
              onFiltersChanged?.();
            }}
          />
          <FilterChips
            label={t.map.filtersLevel}
            options={levelFilters(t)}
            value={level}
            onChange={(v) => {
              setLevel(v);
              onFiltersChanged?.();
            }}
            className="mt-2"
          />
        </div>
      )}
    </div>
  );
}

function FilterChips({
  label,
  options,
  value,
  onChange,
  className = "",
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <fieldset className={className}>
      <legend className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={active}
              className={`min-h-9 cursor-pointer rounded-full px-3 py-1.5 text-xs font-bold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                active
                  ? "bg-ink text-white"
                  : "bg-muted text-ink/70 hover:bg-line hover:text-ink"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
