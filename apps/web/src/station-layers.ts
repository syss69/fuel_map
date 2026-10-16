import type { GeoJSONSource, Map, MapMouseEvent } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { StationMarker } from './api';

export const STATION_SOURCE = 'fuel-stations';
const POINTS = 'fuel-station-points';
const CLUSTERS = 'fuel-station-clusters';
const SELECTED = 'fuel-station-selected';
export function stationFeatures(stations: StationMarker[]): FeatureCollection<Point> {
  return { type: 'FeatureCollection', features: stations.map(station => ({
    type: 'Feature', id: station.id, geometry: { type: 'Point', coordinates: [station.lng, station.lat] },
    properties: { stationId: station.id, hasFuel: station.availableFuels.length > 0 },
  })) };
}

/** One source, constant-sized layer set and one click handler for all station counts. */
export function installStationLayers(map: Map, select: (id: string) => void, pickingPoint: () => boolean) {
  let data = stationFeatures([]), selected: string | null = null, revision = 0, disposed = false;
  const draw = () => {
    if (map.getSource(STATION_SOURCE)) return;
    map.addSource(STATION_SOURCE, { type: 'geojson', data, cluster: true, clusterRadius: 45, clusterMaxZoom: 12 });
    map.addLayer({ id: CLUSTERS, type: 'circle', source: STATION_SOURCE, filter: ['has', 'point_count'], paint: {
      'circle-color': '#52665f', 'circle-radius': ['step', ['get', 'point_count'], 18, 10, 22, 50, 27], 'circle-stroke-color': '#fffef9', 'circle-stroke-width': 2,
    } });
    map.addLayer({ id: 'fuel-station-cluster-count', type: 'symbol', source: STATION_SOURCE, filter: ['has', 'point_count'], layout: {
      'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13, 'text-font': ['Noto Sans Regular'], 'text-allow-overlap': true,
    }, paint: { 'text-color': '#ffffff' } });
    map.addLayer({ id: POINTS, type: 'circle', source: STATION_SOURCE, filter: ['!', ['has', 'point_count']], paint: {
      'circle-radius': 9, 'circle-color': ['case', ['get', 'hasFuel'], '#176b51', '#e45c35'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3,
    } });
    map.addLayer({ id: SELECTED, type: 'circle', source: STATION_SOURCE, filter: ['==', ['get', 'stationId'], selected ?? ''], paint: {
      'circle-radius': 15, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#125cbd', 'circle-stroke-width': 3,
    } });
  };
  const click = async (event: MapMouseEvent) => {
    if (pickingPoint() || !map.getLayer(POINTS)) return;
    const feature = map.queryRenderedFeatures(event.point, { layers: [POINTS, CLUSTERS] })[0];
    if (!feature) return;
    if (feature.properties.cluster) {
      const version = revision;
      const zoom = await (map.getSource(STATION_SOURCE) as GeoJSONSource).getClusterExpansionZoom(Number(feature.properties.cluster_id)).catch(() => null);
      if (disposed || version !== revision || zoom === null || pickingPoint() || feature.geometry.type !== 'Point') return;
      map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom });
    } else select(String(feature.properties.stationId));
  };
  const hover = (event: MapMouseEvent) => {
    if (pickingPoint()) { map.getCanvas().style.cursor = 'crosshair'; return; }
    map.getCanvas().style.cursor = map.getLayer(POINTS) && map.queryRenderedFeatures(event.point, { layers: [POINTS, CLUSTERS] }).length ? 'pointer' : '';
  };
  if (map.isStyleLoaded()) draw();
  map.on('style.load', draw); map.on('idle', draw); map.on('click', click); map.on('mousemove', hover);
  return {
    update(stations: StationMarker[]) {
      revision++; data = stationFeatures(stations);
      (map.getSource(STATION_SOURCE) as GeoJSONSource | undefined)?.setData(data);
    },
    select(id: string | null) { selected = id; if (map.getLayer(SELECTED)) map.setFilter(SELECTED, ['==', ['get', 'stationId'], selected ?? '']); },
    remove() {
      disposed = true; map.off('style.load', draw); map.off('idle', draw); map.off('click', click); map.off('mousemove', hover);
      for (const id of [SELECTED, 'fuel-station-cluster-count', POINTS, CLUSTERS]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(STATION_SOURCE)) map.removeSource(STATION_SOURCE);
    },
  };
}
