export const FUEL_TYPES = [
  { id: 1, code: 'GAZOLE', label: 'Gazole', sortOrder: 1 },
  { id: 2, code: 'SP95', label: 'SP95', sortOrder: 2 },
  { id: 3, code: 'SP98', label: 'SP98', sortOrder: 3 },
  { id: 4, code: 'E10', label: 'E10', sortOrder: 4 },
  { id: 5, code: 'E85', label: 'E85', sortOrder: 5 },
  { id: 6, code: 'GPLC', label: 'GPLc', sortOrder: 6 },
] as const;

export type FuelCode = (typeof FUEL_TYPES)[number]['code'];
export type FuelAvailability =
  | 'AVAILABLE'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'PERMANENTLY_UNAVAILABLE'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export interface NormalizedFuel {
  code: FuelCode;
  priceMilliEur: number | null;
  availability: FuelAvailability;
  sourcePriceUpdatedAt: Date | null;
  sourceRuptureStartedAt: Date | null;
}

export interface NormalizedStation {
  officialId: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  departmentCode: string;
  latitude: number;
  longitude: number;
  fuels: NormalizedFuel[];
}
