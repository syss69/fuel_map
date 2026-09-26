import { Inject, Injectable, Logger } from '@nestjs/common';
import { FUEL_TYPES, FuelAvailability, NormalizedStation } from '@fuel-map/database';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { FUEL_DATA_PROVIDER, FuelDataProvider } from './providers/fuel-data.provider';
import { OpenDataStationMapper } from './mappers/open-data-station.mapper';

const ADVISORY_LOCK_ID = 6400152026;

interface ImportStats {
  recordsReceived: number;
  recordsValid: number;
  recordsInvalid: number;
  stationsCreated: number;
  stationsMetadataUpdated: number;
  fuelStatesChanged: number;
  historyRowsCreated: number;
}

interface CurrentFuelRow {
  fuel_type_id: number;
  price_milli_eur: number | null;
  availability: FuelAvailability;
  source_rupture_started_at: Date | null;
}

@Injectable()
export class FuelImportService {
  private readonly logger = new Logger(FuelImportService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(FUEL_DATA_PROVIDER) private readonly provider: FuelDataProvider,
    private readonly mapper: OpenDataStationMapper,
  ) {}

  async runImport(trigger: 'initial' | 'scheduled' | 'manual'): Promise<void> {
    const started = Date.now();
    const client = await this.db.pool.connect();
    let acquired = false;
    let runId: string | undefined;
    const stats: ImportStats = {
      recordsReceived: 0,
      recordsValid: 0,
      recordsInvalid: 0,
      stationsCreated: 0,
      stationsMetadataUpdated: 0,
      fuelStatesChanged: 0,
      historyRowsCreated: 0,
    };

    try {
      const lock = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS acquired',
        [ADVISORY_LOCK_ID],
      );
      acquired = lock.rows[0]?.acquired === true;
      if (!acquired) {
        this.logger.log(`Fuel import skipped (${trigger}): advisory lock is held`);
        return;
      }

      const run = await client.query<{ id: string }>(
        `INSERT INTO import_runs (status, started_at) VALUES ('RUNNING', now()) RETURNING id`,
      );
      runId = run.rows[0].id;
      this.logger.log(`Fuel import started (${trigger}, run ${runId})`);

      const records = await this.provider.fetchStations();
      stats.recordsReceived = records.length;
      const stations: NormalizedStation[] = [];
      for (const record of records) {
        try {
          stations.push(this.mapper.map(record));
        } catch (error) {
          stats.recordsInvalid += 1;
          const officialId = typeof record.id === 'string' || typeof record.id === 'number' ? record.id : 'unknown';
          this.logger.warn(`Skipping invalid station ${officialId}: ${this.message(error)}`);
        }
      }
      stats.recordsValid = stations.length;
      if (stations.length === 0) throw new Error('Fuel API returned no valid stations');
      this.logger.log(`Received ${records.length} external records; ${stats.recordsInvalid} invalid`);

      await client.query('BEGIN');
      try {
        await this.synchronize(client, stations, stats);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

      await this.finishRun(client, runId, 'SUCCESS', stats, null);
      this.logger.log(
        `Fuel import succeeded in ${Date.now() - started}ms: ` +
          `${stats.stationsCreated} stations created, ${stats.stationsMetadataUpdated} metadata updated, ` +
          `${stats.fuelStatesChanged} fuel states changed, ${stats.historyRowsCreated} history rows`,
      );
    } catch (error) {
      const message = this.message(error).slice(0, 1_000);
      if (runId) {
        try {
          await this.finishRun(client, runId, 'FAILED', stats, message);
        } catch (auditError) {
          this.logger.error(`Could not mark import run failed: ${this.message(auditError)}`);
        }
      }
      this.logger.error(`Fuel import failed after ${Date.now() - started}ms: ${message}`);
      throw error;
    } finally {
      if (acquired) {
        try {
          await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]);
        } catch (error) {
          this.logger.error(`Could not release advisory lock: ${this.message(error)}`);
        }
      }
      client.release();
    }
  }

  private async synchronize(client: PoolClient, stations: NormalizedStation[], stats: ImportStats): Promise<void> {
    const fuelResult = await client.query<{ id: number; code: string }>('SELECT id, code FROM fuel_types');
    const fuelIds = new Map(fuelResult.rows.map((row) => [row.code, row.id]));
    if (FUEL_TYPES.some((fuel) => !fuelIds.has(fuel.code))) {
      throw new Error('fuel_types is not seeded; run npm run db:seed');
    }

    for (const station of stations) {
      const existing = await client.query<{
        id: string;
        address: string | null;
        city: string | null;
        postal_code: string | null;
        department_code: string;
        lat: number;
        lng: number;
      }>(
        `SELECT id, address, city, postal_code, department_code,
                ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
         FROM stations WHERE official_id = $1`,
        [station.officialId],
      );

      let stationId: string;
      const current = existing.rows[0];
      if (!current) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO stations
             (official_id, address, city, postal_code, department_code, location, last_seen_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, now(), now(), now())
           RETURNING id`,
          [
            station.officialId,
            station.address,
            station.city,
            station.postalCode,
            station.departmentCode,
            station.longitude,
            station.latitude,
          ],
        );
        stationId = inserted.rows[0].id;
        stats.stationsCreated += 1;
      } else {
        stationId = current.id;
        const metadataChanged =
          current.address !== station.address ||
          current.city !== station.city ||
          current.postal_code !== station.postalCode ||
          current.department_code !== station.departmentCode ||
          Number(current.lat) !== station.latitude ||
          Number(current.lng) !== station.longitude;
        await client.query(
          `UPDATE stations SET address = $2, city = $3, postal_code = $4, department_code = $5,
             location = ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
             last_seen_at = now(), updated_at = now()
           WHERE id = $1`,
          [
            stationId,
            station.address,
            station.city,
            station.postalCode,
            station.departmentCode,
            station.longitude,
            station.latitude,
          ],
        );
        if (metadataChanged) stats.stationsMetadataUpdated += 1;
      }

      const currentFuels = await client.query<CurrentFuelRow>(
        `SELECT fuel_type_id, price_milli_eur, availability, source_rupture_started_at
         FROM station_fuels WHERE station_id = $1`,
        [stationId],
      );
      const byType = new Map(currentFuels.rows.map((row) => [row.fuel_type_id, row]));
      for (const fuel of station.fuels) {
        const fuelTypeId = fuelIds.get(fuel.code)!;
        const previous = byType.get(fuelTypeId);
        const changed =
          !previous ||
          previous.price_milli_eur !== fuel.priceMilliEur ||
          previous.availability !== fuel.availability ||
          this.time(previous.source_rupture_started_at) !== this.time(fuel.sourceRuptureStartedAt);

        await client.query(
          `INSERT INTO station_fuels
             (station_id, fuel_type_id, price_milli_eur, availability, source_price_updated_at,
              source_rupture_started_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (station_id, fuel_type_id) DO UPDATE SET
             price_milli_eur = EXCLUDED.price_milli_eur,
             availability = EXCLUDED.availability,
             source_price_updated_at = EXCLUDED.source_price_updated_at,
             source_rupture_started_at = EXCLUDED.source_rupture_started_at,
             updated_at = now()`,
          [
            stationId,
            fuelTypeId,
            fuel.priceMilliEur,
            fuel.availability,
            fuel.sourcePriceUpdatedAt,
            fuel.sourceRuptureStartedAt,
          ],
        );
        if (changed) {
          await client.query(
            `INSERT INTO station_fuel_history
               (station_id, fuel_type_id, price_milli_eur, availability, source_price_updated_at,
                source_rupture_started_at, observed_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())`,
            [
              stationId,
              fuelTypeId,
              fuel.priceMilliEur,
              fuel.availability,
              fuel.sourcePriceUpdatedAt,
              fuel.sourceRuptureStartedAt,
            ],
          );
          stats.fuelStatesChanged += 1;
          stats.historyRowsCreated += 1;
        }
      }
    }
  }

  private async finishRun(
    client: PoolClient,
    runId: string,
    status: 'SUCCESS' | 'FAILED',
    stats: ImportStats,
    error: string | null,
  ): Promise<void> {
    await client.query(
      `UPDATE import_runs SET status = $2, finished_at = now(), records_received = $3,
         records_valid = $4, records_invalid = $5, stations_created = $6,
         stations_metadata_updated = $7, fuel_states_changed = $8, history_rows_created = $9,
         error_message = $10 WHERE id = $1`,
      [
        runId,
        status,
        stats.recordsReceived,
        stats.recordsValid,
        stats.recordsInvalid,
        stats.stationsCreated,
        stats.stationsMetadataUpdated,
        stats.fuelStatesChanged,
        stats.historyRowsCreated,
        error,
      ],
    );
  }

  private time(value: Date | null): number | null {
    return value ? new Date(value).getTime() : null;
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
