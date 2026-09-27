import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as maplibregl from 'maplibre-gl';
import type { Map, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { fetchStations } from './api';
import type { FuelCode } from './api';
import { StationCard } from './StationCard';

const PAU: [number, number] = [-0.3708, 43.2951];
const fuelOptions: Array<{ value: FuelCode | ''; label: string }> = [
  { value: '', label: 'Tous' },
  { value: 'GAZOLE', label: 'Gazole (Diesel)' },
  { value: 'SP95', label: 'SP95' },
  { value: 'SP98', label: 'SP98' },
  { value: 'E10', label: 'E10' },
  { value: 'E85', label: 'E85' },
  { value: 'GPLC', label: 'GPLc' },
];
// Let Vite bundle the worker and its imports instead of resolving it beside an optimized dependency.
maplibregl.setWorkerUrl(mapWorkerUrl);
const mapStyle = import.meta.env.VITE_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fuelFilter, setFuelFilter] = useState<FuelCode | ''>('');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const stations = useQuery({ queryKey: ['stations'], queryFn: fetchStations, refetchInterval: 60_000 });
  const visibleStations = useMemo(() => (stations.data?.stations ?? []).filter(
    (station) => !fuelFilter || station.availableFuels.includes(fuelFilter),
  ), [stations.data, fuelFilter]);

  useEffect(() => {
    if (selectedId && !visibleStations.some((station) => station.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, visibleStations]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle,
      center: PAU,
      zoom: 11,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = visibleStations.map((station) => {
      const element = document.createElement('button');
      const hasFuel = station.availableFuels.length > 0;
      const availabilityLabel = hasFuel ? 'Carburant disponible' : 'Aucun carburant déclaré disponible';
      element.className = `station-marker${hasFuel ? ' station-marker-available' : ''}`;
      element.type = 'button';
      element.title = `${station.displayName} — ${availabilityLabel}`;
      element.setAttribute('aria-label', `Afficher ${station.displayName} — ${availabilityLabel}`);
      element.addEventListener('click', () => setSelectedId(station.id));
      return new maplibregl.Marker({ element })
        .setLngLat([station.lng, station.lat])
        .addTo(map);
    });
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
    };
  }, [visibleStations]);

  return (
    <main className="app-shell">
      <div ref={containerRef} className="map" aria-label="Carte des stations-service des Pyrénées-Atlantiques" />
      <div className="masthead">
        <div className="logo-mark">64</div>
        <div>
          <h1>Carburants 64</h1>
          <p>Prix des stations autour de Pau et dans le département</p>
        </div>
      </div>
      <fieldset className={`fuel-filter${filtersExpanded ? '' : ' fuel-filter-collapsed'}`}>
        <legend>Carburant</legend>
        <button className="fuel-filter-toggle" type="button"
          aria-expanded={filtersExpanded} aria-controls="fuel-filter-options"
          aria-label={`${filtersExpanded ? 'Masquer les filtres' : 'Afficher les filtres'} — ${fuelOptions.find(option => option.value === fuelFilter)?.label}`}
          data-active={Boolean(fuelFilter)}
          onClick={() => setFiltersExpanded((expanded) => !expanded)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {filtersExpanded ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M3 4h18l-7 8v7l-4 2v-9Z" />}
          </svg>
        </button>
        <div className="fuel-filter-options" id="fuel-filter-options">
          {fuelOptions.map(({ value, label }) => (
            <button className="fuel-filter-option" key={value} type="button"
              aria-pressed={fuelFilter === value}
              onClick={() => setFuelFilter((current) => current === value ? '' : value)}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      {stations.isPending && <div className="map-message">Chargement des stations…</div>}
      {stations.isError && (
        <div className="map-message error">Les stations ne peuvent pas être chargées pour le moment.</div>
      )}
      {!stations.isPending && stations.data && (
        <div className="station-count" role="status">
          {fuelFilter && visibleStations.length === 0
            ? 'Aucune station avec ce carburant disponible'
            : `${visibleStations.length} stations affichées`}
          <small className="last-update" title="Dernière synchronisation réussie avec la source des données">
            {stations.data.updatedAt ? <>
              Données synchronisées le{' '}
              <time dateTime={stations.data.updatedAt}>
                {new Intl.DateTimeFormat('fr-FR', {
                  day: '2-digit', month: '2-digit', year: 'numeric',
                  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
                }).format(new Date(stations.data.updatedAt))}
              </time>
              {' (Paris)'}
            </> : 'Aucune synchronisation réussie'}
          </small>
        </div>
      )}
      {selectedId && <StationCard stationId={selectedId} selectedFuel={fuelFilter} onClose={() => setSelectedId(null)} />}
    </main>
  );
}
