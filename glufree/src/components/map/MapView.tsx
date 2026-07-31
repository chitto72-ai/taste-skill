"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Place } from "@/lib/types";

const PIN_COLORS: Record<Place["glutenFreeLevel"], string> = {
  dedicated: "#059669",
  certified: "#2563EB",
  options: "#EA580C",
};

function pinIcon(place: Place, active: boolean): L.DivIcon {
  const color = PIN_COLORS[place.glutenFreeLevel];
  const check =
    place.verification === "verified"
      ? `<circle cx="26" cy="8" r="7" fill="#0F172A"/><path d="M22.8 8l2.2 2.2 4-4" stroke="#34D399" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
      : "";
  // Pin "In evidenza": bordo dorato più spesso + stellina, per distinguerlo
  const stroke = place.featured ? "#F59E0B" : "#fff";
  const strokeW = place.featured ? 3 : 2;
  const star = place.featured
    ? `<path d="M18 8.6l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="#F59E0B"/>`
    : "";
  return L.divIcon({
    className: `glufree-pin${active ? " glufree-pin--active" : ""}${place.featured ? " glufree-pin--featured" : ""}`,
    html: `<svg width="36" height="46" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${place.name}">
      <path d="M18 1C9.2 1 2 8.2 2 17c0 11.5 13.2 25.6 14.7 27.2a1.8 1.8 0 0 0 2.6 0C20.8 42.6 34 28.5 34 17 34 8.2 26.8 1 18 1z" fill="${color}" stroke="${stroke}" stroke-width="${strokeW}"/>
      <circle cx="18" cy="17" r="7.5" fill="#fff"/>
      ${
        star ||
        `<path d="M14.5 17.5l2.4 2.4 4.6-4.8" stroke="${color}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
      }
      ${check}
    </svg>`,
    iconSize: [36, 46],
    iconAnchor: [18, 45],
    popupAnchor: [0, -40],
  });
}

const userIcon = L.divIcon({
  className: "glufree-pin",
  html: `<svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="La tua posizione">
    <circle cx="13" cy="13" r="11" fill="#2563EB" fill-opacity="0.25"/>
    <circle cx="13" cy="13" r="6" fill="#2563EB" stroke="#fff" stroke-width="2.5"/>
  </svg>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

/** Centra la mappa quando cambia il luogo selezionato o la posizione utente. */
function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo(target, Math.max(map.getZoom(), 14), { duration: 0.8 });
    }
  }, [map, target]);
  return null;
}

function FitToPlaces({ places, enabled }: { places: Place[]; enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled || places.length === 0) return;
    const bounds = L.latLngBounds(places.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  }, [map, places, enabled]);
  return null;
}

export interface MapViewProps {
  places: Place[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  userPosition: [number, number] | null;
  /** Adatta la vista ai risultati (disattivato dopo la prima interazione) */
  fitResults: boolean;
}

export default function MapView({
  places,
  selectedId,
  onSelect,
  userPosition,
  fitResults,
}: MapViewProps) {
  const selected = useMemo(
    () => places.find((p) => p.id === selectedId) ?? null,
    [places, selectedId]
  );

  const flyTarget: [number, number] | null = selected
    ? [selected.lat, selected.lng]
    : userPosition;

  return (
    <MapContainer
      center={[42.5, 12.5]}
      zoom={6}
      minZoom={2}
      className="h-full w-full"
      zoomControl={false}
      attributionControl
      // Blocca la navigazione a un'unica copia del mondo: senza questo, scorrendo
      // oltre i bordi si finisce su una copia duplicata dove i marker non esistono.
      maxBounds={[
        [-85, -180],
        [85, 180],
      ]}
      maxBoundsViscosity={1}
      worldCopyJump={false}
    >
      <TileLayer
        className="glufree-tiles"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png"
        noWrap
      />
      <FitToPlaces places={places} enabled={fitResults} />
      <FlyTo target={flyTarget} />
      {userPosition && <Marker position={userPosition} icon={userIcon} interactive={false} />}
      {places.map((place) => (
        <Marker
          key={place.id}
          position={[place.lat, place.lng]}
          icon={pinIcon(place, place.id === selectedId)}
          eventHandlers={{ click: () => onSelect(place.id) }}
          keyboard
          alt={`${place.name}, ${place.city}`}
        />
      ))}
    </MapContainer>
  );
}
