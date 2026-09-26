export type ExternalStation = Record<string, unknown>;

export interface FuelDataProvider {
  fetchStations(): Promise<ExternalStation[]>;
}

export const FUEL_DATA_PROVIDER = Symbol('FUEL_DATA_PROVIDER');
