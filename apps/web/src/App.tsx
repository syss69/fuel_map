import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as maplibregl from 'maplibre-gl';
import type { Map, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { fetchStations } from './api';
import { StationCard } from './StationCard';

const PAU: [number, number] = [-0.3708, 43.2951];
// Let Vite bundle the worker and its imports instead of resolving it beside an optimized dependency.
maplibregl.setWorkerUrl(mapWorkerUrl);
const mapStyle = import.meta.env.VITE_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const stations = useQuery({ queryKey: ['stations'], queryFn: fetchStations });

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
    if (!map || !stations.data) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = stations.data.stations.map((station) => {
      const element = document.createElement('button');
      element.className = 'station-marker';
      element.type = 'button';
      element.title = station.displayName;
      element.setAttribute('aria-label', `Afficher ${station.displayName}`);
      element.addEventListener('click', () => setSelectedId(station.id));
      return new maplibregl.Marker({ element })
        .setLngLat([station.lng, station.lat])
        .addTo(map);
    });
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
    };
  }, [stations.data]);

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
      {stations.isPending && <div className="map-message">Chargement des stations…</div>}
      {stations.isError && (
        <div className="map-message error">Les stations ne peuvent pas être chargées pour le moment.</div>
      )}
      {!stations.isPending && stations.data && (
        <div className="station-count">{stations.data.stations.length} stations à jour</div>
      )}
      {selectedId && <StationCard stationId={selectedId} onClose={() => setSelectedId(null)} />}
    </main>
  );
}
