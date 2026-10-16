import { Map, Marker, setWorkerUrl } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { installStationLayers } from '../src/station-layers';
import { installGeolocation } from '../src/map-geolocation';
import type { StationMarker } from '../src/api';
const element = (id: string) => document.getElementById(id)!;
setWorkerUrl(mapWorkerUrl);
let geoRequests = 0;
Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
  getCurrentPosition(success: PositionCallback, error: PositionErrorCallback) {
    geoRequests++; element('geo-status').textContent = `Requests: ${geoRequests}`;
    const mode = (element('geo-mode') as HTMLSelectElement).value;
    setTimeout(() => {
      if (mode === 'denied' || mode === 'timeout') { error({ code: mode === 'denied' ? 1 : 3, message: 'Simulated', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); return; }
      success({ coords: { latitude: mode === 'outside' ? 48.85 : 43.233, longitude: mode === 'outside' ? 2.35 : .078, accuracy: mode === 'imprecise' ? 30000 : 20, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition);
    }, mode === 'delayed' ? 4000 : 100);
  }, watchPosition() { throw new Error('Continuous tracking must not be used'); }, clearWatch() {},
} });
const map = new Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty', center: [-.3708,43.2951], zoom: 11,
  locale: { 'GeolocateControl.FindMyLocation': 'Me localiser' } });
map.on('moveend', () => element('camera').textContent = `Center: ${map.getCenter().lng.toFixed(4)}, ${map.getCenter().lat.toFixed(4)}; zoom: ${map.getZoom().toFixed(2)}`);
installGeolocation(map, message => element('geo-status').textContent = `Requests: ${geoRequests} — ${message}`);
let layers = installStationLayers(map, id => element('status').textContent = `Selected: ${id}`, () => false);
const stations: StationMarker[] = (await (await fetch('http://127.0.0.1:3104/api/v1/stations')).json()).stations;
layers.update(stations); element('status').textContent = `${stations.length} stations; geolocation requests: ${geoRequests}`;
element('pan').onclick = () => map.jumpTo({ center: [-.4, 43.3], zoom: 11 });
async function measure() {
  const frames: number[] = []; let last = performance.now();
  for (let i = 0; i < 90; i++) {
    await new Promise(requestAnimationFrame); const now = performance.now(); frames.push(now - last); last = now;
    map.jumpTo({ center: [-.37 + i * .0002, 43.2951], zoom: 11 });
  }
  frames.sort((a,b) => a-b);
  return { domElements: document.querySelectorAll('*').length, stationMarkers: document.querySelectorAll('.station-marker').length, medianFrameMs: Math.round(frames[45]), p95FrameMs: Math.round(frames[85]) };
}
element('benchmark').onclick = async () => {
  (element('benchmark') as HTMLButtonElement).disabled = true;
  map.jumpTo({ center: [-.37, 43.2951], zoom: 11 });
  await new Promise(resolve => map.once('idle', resolve));
  layers.remove();
  const markers = stations.map(s => { const button = document.createElement('button'); button.className = 'station-marker'; button.style.cssText = 'width:22px;height:22px;background:green;border:3px solid white;border-radius:50%'; return new Marker({ element: button }).setLngLat([s.lng,s.lat]).addTo(map); });
  const before = await measure(); markers.forEach(marker => marker.remove());
  map.jumpTo({ center: [-.37, 43.2951], zoom: 11 });
  layers = installStationLayers(map, () => {}, () => false); layers.update(stations);
  await new Promise(resolve => map.once('idle', resolve));
  const after = await measure(); element('results').textContent = JSON.stringify({ stations: stations.length, htmlMarkers: before, geojsonLayers: after }, null, 2);
  (element('benchmark') as HTMLButtonElement).disabled = false;
};
