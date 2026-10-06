export type Availability =
  | 'AVAILABLE'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'PERMANENTLY_UNAVAILABLE'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export type FuelCode = 'GAZOLE' | 'SP95' | 'SP98' | 'E10' | 'E85' | 'GPLC';

export interface StationMarker {
  address: string | null;
  city: string | null;
  id: string;
  displayName: string;
  brand: string | null;
  lat: number;
  lng: number;
  availableFuels: FuelCode[];
}

export interface StationDetail {
  lastSyncedAt: string;
  community: CommunityState;
  queue: QueueAggregate;
  id: string;
  officialId: string;
  displayName: string;
  brand: string | null;
  address: string | null;
  city: string | null;
  location: { lat: number; lng: number };
  fuels: Array<{
    code: FuelCode;
    label: string;
    priceMilliEur: number | null;
    availability: Availability;
    sourceUpdatedAt: string | null;
  }>;
}

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';
export async function digestRequest(path:string, body:unknown):Promise<{message:string}> {
  const response=await fetch(`${baseUrl}/digest-subscriptions${path}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.message || 'Service temporairement indisponible. Réessayez.');
  return data;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
  return (await response.json()) as T;
}

export function fetchStations(): Promise<{ stations: StationMarker[]; updatedAt: string | null }> {
  return getJson('/stations');
}

export function fetchStation(id: string, reporterId: string): Promise<StationDetail> {
  return getJson(`/stations/${encodeURIComponent(id)}?reporterId=${encodeURIComponent(reporterId)}`);
}

export type QueueStatus = 'NONE' | 'LT_5' | 'FROM_5_TO_10' | 'FROM_11_TO_15' | 'GT_15';
export interface QueueAggregate {
  status: QueueStatus | null;
  reportsCount: number;
  confirmationsCount: number;
  lastReportedAt: string | null;
  statusLastReportedAt: string | null;
  latestReport: { status: QueueStatus; updatedAt: string } | null;
  myReport: { status: QueueStatus; updatedAt: string } | null;
}

export async function reportQueue(id: string, reporterId: string, status: QueueStatus): Promise<QueueAggregate> {
  const response = await fetch(`${baseUrl}/stations/${encodeURIComponent(id)}/queue-report`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reporterId, status }),
  });
  if (!response.ok) throw new Error('Impossible d’envoyer le signalement. Réessayez.');
  return response.json();
}

export type CommunityAvailability = 'AVAILABLE' | 'UNAVAILABLE';
export interface FuelDiscrepancy {
  fuelCode: FuelCode;
  availability: { value: CommunityAvailability; reportsCount: number; lastReportedAt: string } | null;
  price: { valueMilliEur: number; reportsCount: number; lastReportedAt: string } | null;
}
export interface CommunityState {
  confirmationsCount: number;
  myConfirmationActive: boolean;
  hasDiscrepancies: boolean;
  fuelDiscrepancies: FuelDiscrepancy[];
}
export interface FuelProposal {
  fuelCode: FuelCode;
  availability?: CommunityAvailability;
  priceMilliEur?: number;
}
export async function submitCommunity(id: string, reporterId: string, fuels?: FuelProposal[]): Promise<CommunityState> {
  const response = await fetch(`${baseUrl}/stations/${encodeURIComponent(id)}/${fuels ? 'fuel-reports' : 'confirmation'}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fuels ? { reporterId, fuels } : { reporterId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.message === 'string' ? body.message : 'Envoi impossible. Réessayez.');
  }
  return response.json();
}
