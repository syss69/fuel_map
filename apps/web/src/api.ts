export type Availability =
  | 'AVAILABLE'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'PERMANENTLY_UNAVAILABLE'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export interface StationMarker {
  id: string;
  displayName: string;
  brand: string | null;
  lat: number;
  lng: number;
}

export interface StationDetail {
  id: string;
  officialId: string;
  displayName: string;
  brand: string | null;
  address: string | null;
  city: string | null;
  location: { lat: number; lng: number };
  fuels: Array<{
    code: string;
    label: string;
    priceMilliEur: number | null;
    availability: Availability;
    sourceUpdatedAt: string | null;
  }>;
}

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
  return (await response.json()) as T;
}

export function fetchStations(): Promise<{ stations: StationMarker[] }> {
  return getJson('/stations');
}

export function fetchStation(id: string): Promise<StationDetail> {
  return getJson(`/stations/${encodeURIComponent(id)}`);
}
