import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { getConfig } from '../../config';
import { ExternalStation, FuelDataProvider } from './fuel-data.provider';

const collectionSchema = z.array(z.record(z.unknown())).min(1);

@Injectable()
export class OpenDataFuelProvider implements FuelDataProvider {
  async fetchStations(): Promise<ExternalStation[]> {
    const config = getConfig();
    const url = new URL(
      '/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/exports/json',
      config.FUEL_API_BASE_URL,
    );
    url.searchParams.set('where', `code_departement="${config.FUEL_DATASET_DEPARTMENT}"`);

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) {
          const retryAfter = this.retryAfterMs(response.headers.get('retry-after'));
          if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
            await this.delay(retryAfter ?? [1_000, 3_000][attempt]);
            continue;
          }
          throw new Error(`Fuel API returned HTTP ${response.status}`);
        }
        const payload: unknown = await response.json();
        return collectionSchema.parse(payload);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < 2) await this.delay([1_000, 3_000][attempt]);
      }
    }
    throw lastError ?? new Error('Fuel API request failed');
  }

  private retryAfterMs(value: string | null): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1_000, 15_000);
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.min(Math.max(date - Date.now(), 0), 15_000);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
