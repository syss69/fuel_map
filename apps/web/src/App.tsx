import { installStationLayers } from './station-layers';
import { installGeolocation } from './map-geolocation';
import { ViewportStations } from './ViewportStations';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as maplibregl from 'maplibre-gl';
import type { Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { fetchStations } from './api';
import type { FuelCode } from './api';
import { StationCard } from './StationCard';
import { DigestPanel } from './DigestPanel';
import { alertRequest } from './alerts-api';
import type { DigestFavorite, ManagedDigest } from './digest-management';

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
  const layersRef = useRef<ReturnType<typeof installStationLayers> | null>(null);
  const [mapInstance, setMapInstance] = useState<Map | null>(null);
  const [locationMessage, setLocationMessage] = useState('');
  const chooseRef = useRef<(id: string) => void>(() => {});
  const linkedStation = useRef(new URLSearchParams(location.search).get('station'));
  const linkedFuel = new URLSearchParams(location.search).get('fuel');
  const [selectedId, setSelectedId] = useState<string | null>(()=>new URLSearchParams(location.search).get('station'));
  const [fuelFilter, setFuelFilter] = useState<FuelCode | ''>('');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [digestEditing]=useState(()=>new URLSearchParams(location.search).get('digest')==='edit');
  const [digestOpen,setDigestOpen]=useState(()=>new URLSearchParams(location.search).get('digest')==='open'||digestEditing);
  const [pickingPoint,setPickingPoint]=useState(false);
  const [pickingFavorite,setPickingFavorite]=useState(false);
  const [digestFavorite,setDigestFavorite]=useState<DigestFavorite|null>(null);
  const pickingFavoriteRef=useRef(false);
  pickingFavoriteRef.current=pickingFavorite;
  const [digestPoint,setDigestPoint]=useState<{lat:number;lng:number}|null>(null);
  const [digestRadius,setDigestRadius]=useState(10000);
  const editor=useQuery({queryKey:['digest-editor'],enabled:digestEditing,retry:false,staleTime:0,refetchOnWindowFocus:false,
    queryFn:async()=>{const me=await alertRequest<{email:string}>('/me');const digest=await alertRequest<ManagedDigest|null>('/digest');return {email:me.email,digest};}});
  const [editing,setEditing]=useState<{email:string;digest:ManagedDigest}|undefined>();
  const pickingRef=useRef(false);
  pickingRef.current=pickingPoint;
  const stations = useQuery({ queryKey: ['stations'], queryFn: fetchStations, refetchInterval: 60_000 });
  const visibleStations = useMemo(() => (stations.data?.stations ?? []).filter(
    (station) => pickingFavorite || !fuelFilter || station.availableFuels.includes(fuelFilter),
  ), [stations.data, fuelFilter, pickingFavorite]);

  chooseRef.current = id => {
    if (pickingRef.current) return;
    const station = visibleStations.find(item => item.id === id);
    if (!station) return;
    if (pickingFavoriteRef.current) { setDigestFavorite(station); setPickingFavorite(false); }
    else if (!digestEditing) { history.replaceState(null, '', location.pathname); setSelectedId(id); }
  };

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
      locale: { 'GeolocateControl.FindMyLocation': 'Me localiser', 'GeolocateControl.LocationNotAvailable': 'Localisation indisponible : vérifiez les autorisations du navigateur' },
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;
    setMapInstance(map);
    const layers = installStationLayers(map, id => chooseRef.current(id), () => pickingRef.current);
    layersRef.current = layers;
    const removeGeolocation = installGeolocation(map, setLocationMessage);
    map.on('click',event=>{
      if(pickingRef.current){const point=event.lngLat.wrap();setDigestPoint({lat:point.lat,lng:point.lng});setPickingPoint(false);}
    });
    return () => {
      removeGeolocation();
      layers.remove();
      layersRef.current = null;
      map.remove();
      setMapInstance(null);
      mapRef.current = null;
    };
  }, []);

  useEffect(()=>{
    if(!digestEditing)return;
    if((editor.error as {status?:number}|null)?.status===401){location.replace('/mes-alertes');return;}
    if(editor.data&&!editor.data.digest){location.replace('/mes-alertes');return;}
    if(editor.data?.digest&&!editing){
      const digest=editor.data.digest;
      setDigestPoint({lat:digest.lat,lng:digest.lng});setDigestRadius(digest.radiusMeters);
      setDigestFavorite(digest.favoriteStation);setEditing({email:editor.data.email,digest});
      mapRef.current?.jumpTo({center:[digest.lng,digest.lat],zoom:10});
    }
  },[digestEditing,editor.data,editor.error,editing]);

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
    map.on('idle',draw);
    return ()=>{
      map.off('style.load',draw);
      map.off('idle',draw);
      if(map.getLayer('digest-zone-outline'))map.removeLayer('digest-zone-outline');
      if(map.getLayer('digest-zone-fill'))map.removeLayer('digest-zone-fill');
      if(map.getSource('digest-zone'))map.removeSource('digest-zone');
    };
  },[digestPoint,digestOpen,digestRadius]);
  useEffect(()=>{
    if(mapRef.current)mapRef.current.getCanvas().style.cursor=pickingPoint?'crosshair':'';
  },[pickingPoint]);

  useEffect(() => { layersRef.current?.update(visibleStations); }, [visibleStations]);
  useEffect(() => { layersRef.current?.select(selectedId); }, [selectedId]);

  return (
    <main className="app-shell">
      <div ref={containerRef} className="map" aria-label="Carte des stations-service des Pyrénées-Atlantiques et Hautes-Pyrénées" />
      <div className="masthead">
        <div>
          <h1><img className="brand-logo" src="/brand/trajetico-logo-full.png" alt="TrajetIco" width="2172" height="724" /></h1>
          <p>Prix des stations autour de Pau, Tarbes et Lourdes</p>
          <nav className="map-navigation" aria-label="Navigation principale">
            <a href="/" aria-label="Retour à l’accueil">← Accueil</a>
            <a href="/mes-alertes">Mes alertes</a>
          </nav>
          <span className="map-coverage">Couverture : 64 · 65</span>
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
      {locationMessage && <div className="location-message" role="status">{locationMessage}<button aria-label="Fermer le message de localisation" onClick={() => setLocationMessage('')}>×</button></div>}
      {mapInstance && <ViewportStations map={mapInstance} stations={visibleStations} pickingFavorite={pickingFavorite}
        disabled={pickingPoint || selectedId !== null || (digestOpen && !pickingFavorite)}
        choose={id => { const station = visibleStations.find(s => s.id === id); if (station) mapInstance.easeTo({center:[station.lng, station.lat], zoom:Math.max(13,mapInstance.getZoom())}); chooseRef.current(id); }}
        onOpen={() => { setFiltersExpanded(false); setSelectedId(null); }} />}
      {!digestOpen && <button className="digest-launcher" type="button" onClick={()=>{setSelectedId(null);setDigestOpen(true);}}>Digest du matin</button>}
      {digestEditing&&!editing&&<div className="digest-panel"><div className="digest-header"><h2>Mon digest</h2><a href="/mes-alertes" aria-label="Fermer le formulaire">×</a></div><div className="digest-body">{editor.isError?<><p role="alert">{editor.error.message}</p><button onClick={()=>void editor.refetch()}>Réessayer</button></>:<p>Chargement…</p>}</div></div>}
      {digestOpen && (!digestEditing||editing) && <DigestPanel editing={editing} favorite={digestFavorite} initialFuel={fuelFilter} point={digestPoint} picking={pickingPoint} pickingFavorite={pickingFavorite}
        radius={digestRadius} onRadiusChange={setDigestRadius}
        onPickFavorite={()=>{setSelectedId(null);setPickingFavorite(true);}} onClearFavorite={()=>setDigestFavorite(null)}
        onPick={()=>{setSelectedId(null);setPickingPoint(true);}} onCancelPick={()=>setPickingPoint(false)}
        onCancelFavorite={()=>setPickingFavorite(false)}
        onClose={()=>{if(digestEditing){location.assign('/mes-alertes');return;}setDigestOpen(false);setPickingPoint(false);setPickingFavorite(false);}} />}
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
