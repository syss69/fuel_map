import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as maplibregl from 'maplibre-gl';
import type { Map, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { fetchStations } from './api';
import type { FuelCode, StationMarker } from './api';
import { StationCard } from './StationCard';
import { DigestPanel } from './DigestPanel';

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
  const linkedStation = useRef(new URLSearchParams(location.search).get('station'));
  const linkedFuel = new URLSearchParams(location.search).get('fuel');
  const [selectedId, setSelectedId] = useState<string | null>(()=>new URLSearchParams(location.search).get('station'));
  const [fuelFilter, setFuelFilter] = useState<FuelCode | ''>('');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [digestOpen,setDigestOpen]=useState(()=>new URLSearchParams(location.search).get('digest')==='open');
  const [pickingPoint,setPickingPoint]=useState(false);
  const [pickingFavorite,setPickingFavorite]=useState(false);
  const [digestFavorite,setDigestFavorite]=useState<StationMarker|null>(null);
  const pickingFavoriteRef=useRef(false);
  pickingFavoriteRef.current=pickingFavorite;
  const [digestPoint,setDigestPoint]=useState<{lat:number;lng:number}|null>(null);
  const [digestRadius,setDigestRadius]=useState(10000);
  const pickingRef=useRef(false);
  pickingRef.current=pickingPoint;
  const stations = useQuery({ queryKey: ['stations'], queryFn: fetchStations, refetchInterval: 60_000 });
  const visibleStations = useMemo(() => (stations.data?.stations ?? []).filter(
    (station) => pickingFavorite || !fuelFilter || station.availableFuels.includes(fuelFilter),
  ), [stations.data, fuelFilter, pickingFavorite]);

  useEffect(() => {
    if (stations.data && selectedId && !visibleStations.some((station) => station.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, visibleStations, stations.data]);

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
    map.on('click',event=>{
      if(pickingRef.current){const point=event.lngLat.wrap();setDigestPoint({lat:point.lat,lng:point.lng});setPickingPoint(false);}
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(()=>{
    const station=stations.data?.stations.find(s=>s.id===linkedStation.current);
    if(station&&mapRef.current){mapRef.current.jumpTo({center:[station.lng,station.lat],zoom:13});linkedStation.current=null;}
  },[stations.data]);

  useEffect(()=>{
    const map=mapRef.current;if(!map || !digestOpen || !digestPoint)return;
    const marker=new maplibregl.Marker({color:'#125cbd'}).setLngLat([digestPoint.lng,digestPoint.lat]).addTo(map);
    return ()=>{marker.remove();};
  },[digestPoint,digestOpen]);
  useEffect(()=>{
    const map=mapRef.current;
    if(!map || !digestOpen || !digestPoint)return;
    // Geodesic circle: radius stays in metres independently of map zoom and latitude.
    const latitude=digestPoint.lat*Math.PI/180;
    const longitude=digestPoint.lng*Math.PI/180;
    const angle=digestRadius/6371008.8;
    const ring:number[][]=[];
    for(let i=0;i<128;i++){
      const bearing=i*2*Math.PI/128;
      const lat=Math.asin(Math.sin(latitude)*Math.cos(angle)+Math.cos(latitude)*Math.sin(angle)*Math.cos(bearing));
      const lng=longitude+Math.atan2(Math.sin(bearing)*Math.sin(angle)*Math.cos(latitude),Math.cos(angle)-Math.sin(latitude)*Math.sin(lat));
      ring.push([lng*180/Math.PI,lat*180/Math.PI]);
    }
    ring.push([...ring[0]]);
    const draw=()=>{
      if(map.getSource('digest-zone'))return;
      map.addSource('digest-zone',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring]}}});
      map.addLayer({id:'digest-zone-fill',type:'fill',source:'digest-zone',paint:{'fill-color':'#125cbd','fill-opacity':0.1}});
      map.addLayer({id:'digest-zone-outline',type:'line',source:'digest-zone',paint:{'line-color':'#125cbd','line-width':2,'line-dasharray':[3,2]}});
    };
    if(map.isStyleLoaded())draw();
    map.on('style.load',draw);
    return ()=>{
      map.off('style.load',draw);
      if(map.getLayer('digest-zone-outline'))map.removeLayer('digest-zone-outline');
      if(map.getLayer('digest-zone-fill'))map.removeLayer('digest-zone-fill');
      if(map.getSource('digest-zone'))map.removeSource('digest-zone');
    };
  },[digestPoint,digestOpen,digestRadius]);
  useEffect(()=>{
    if(mapRef.current)mapRef.current.getCanvas().style.cursor=pickingPoint?'crosshair':'';
  },[pickingPoint]);

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
      element.setAttribute('aria-label', `${pickingFavorite ? 'Choisir' : 'Afficher'} ${station.displayName} — ${availabilityLabel}`);
      element.addEventListener('click', (event) => {
        if(pickingFavoriteRef.current){
          event.stopPropagation();
          setDigestFavorite(station);
          setPickingFavorite(false);
        } else if(!pickingRef.current){history.replaceState(null,'',location.pathname);setSelectedId(station.id);}
      });
      return new maplibregl.Marker({ element })
        .setLngLat([station.lng, station.lat])
        .addTo(map);
    });
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
    };
  }, [visibleStations, pickingFavorite]);

  return (
    <main className="app-shell">
      <div ref={containerRef} className="map" aria-label="Carte des stations-service des Pyrénées-Atlantiques" />
      <div className="masthead">
        <div>
          <h1><img className="brand-logo" src="/brand/trajetico-logo-full.png" alt="TrajetIco" width="2172" height="724" /></h1>
          <p>Prix des stations autour de Pau et dans le département</p>
          <a href="/mes-alertes">Mes alertes</a>
        </div>
      </div>
      {!pickingFavorite && <fieldset className={`fuel-filter${filtersExpanded ? '' : ' fuel-filter-collapsed'}`}>
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
      </fieldset>}
      {!digestOpen && <button className="digest-launcher" type="button" onClick={()=>{setSelectedId(null);setDigestOpen(true);}}>Digest du matin</button>}
      {digestOpen && <DigestPanel favorite={digestFavorite} initialFuel={fuelFilter} point={digestPoint} picking={pickingPoint} pickingFavorite={pickingFavorite}
        radius={digestRadius} onRadiusChange={setDigestRadius}
        onPickFavorite={()=>{setSelectedId(null);setPickingFavorite(true);}} onClearFavorite={()=>setDigestFavorite(null)}
        onPick={()=>{setSelectedId(null);setPickingPoint(true);}} onCancelPick={()=>setPickingPoint(false)}
        onCancelFavorite={()=>setPickingFavorite(false)}
        onClose={()=>{setDigestOpen(false);setPickingPoint(false);setPickingFavorite(false);}} />}
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
          <small className="last-update">Noms : <a href="https://www.data.gouv.fr/datasets/referentiel-des-noms-et-enseignes-de-stations-service-enrichi-par-openstreetmap" target="_blank" rel="noopener noreferrer">Chiffrex / © OpenStreetMap</a> (ODbL)</small>
        </div>
      )}
      {selectedId && <StationCard stationId={selectedId} selectedFuel={fuelFilter || (fuelOptions.some(f=>f.value===linkedFuel)?linkedFuel as FuelCode:'')} onClose={() => {setSelectedId(null);history.replaceState(null,'',location.pathname);}} />}
    </main>
  );
}
