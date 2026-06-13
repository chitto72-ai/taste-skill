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

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-muted">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <p className="text-sm font-semibold">Carico la mappa…</p>
      </div>
    </div>
  ),
});

const CATEGORY_FILTERS = [
  { value: "", label: "Tutti" },
  { value: "ristorante", label: "Ristoranti" },
  { value: "pizzeria", label: "Pizzerie" },
  { value: "pasticceria", label: "Pasticcerie" },
  { value: "gelateria", label: "Gelaterie" },
  { value: "panetteria", label: "Panetterie" },
  { value: "bar", label: "Bar & Caffè" },
] as const;

const LEVEL_FILTERS = [
  { value: "", label: "Ogni livello" },
  { value: "dedicated", label: "100% Gluten Free" },
  { value: "certified", label: "Certificato AIC" },
  { value: "options", label: "Menu GF dedicato" },
] as const;

export default function MapExplorer() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [level, setLevel] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // La vista parte centrata sull'Italia; si adatta ai risultati solo dopo una ricerca
  const [fitResults, setFitResults] = useState(false);
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
        aria-label="Elenco dei locali"
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
            <motion.div
              key={place.id}
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
          aria-label="Trova locali vicino a me"
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
                  aria-label="Chiudi la scheda del locale"
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
              <List className="h-4 w-4" aria-hidden /> Vedi elenco
            </>
          ) : (
            <>
              <MapIcon className="h-4 w-4" aria-hidden /> Vedi mappa
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
              aria-label="Elenco dei locali"
            >
              <ResultsHeader loading={loading} count={places.length} />
              {places.map((place) => (
                <div key={place.id} role="listitem">
                  <PlaceCard
                    place={place}
                    active={place.id === selectedId}
                    userPosition={userPosition}
                    onClick={() => handleSelect(place.id)}
                  />
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
  return (
    <p className="text-sm font-semibold text-slate-500" aria-live="polite">
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
          Cerco i locali gluten free…
        </span>
      ) : (
        <>
          <span className="font-display text-lg font-bold text-ink">{count}</span>{" "}
          {count === 1 ? "locale trovato" : "locali trovati"}
        </>
      )}
    </p>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white p-8 text-center">
      <p className="font-display text-lg font-bold text-ink">Nessun locale trovato</p>
      <p className="mt-1 text-sm text-slate-500">
        Prova ad allargare la ricerca o a rimuovere qualche filtro.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white transition-colors duration-200 hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        Azzera i filtri
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
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Cerca per città, locale o piatto</span>
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
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
            placeholder="Città, locale o piatto…"
            className="h-12 w-full rounded-2xl border border-line bg-white pl-11 pr-4 text-base shadow-card placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </label>
        {compact && setFiltersOpen && (
          <button
            type="button"
            onClick={() => setFiltersOpen(!filtersOpen)}
            aria-expanded={filtersOpen}
            aria-label={`Filtri${activeFilters > 0 ? `, ${activeFilters} attivi` : ""}`}
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
            label="Categoria"
            options={CATEGORY_FILTERS}
            value={category}
            onChange={(v) => {
              setCategory(v);
              onFiltersChanged?.();
            }}
          />
          <FilterChips
            label="Sicurezza gluten free"
            options={LEVEL_FILTERS}
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
