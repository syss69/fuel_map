import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { getConfig } from '../config';
import { QueueService } from './queue.service';
import { CommunityService } from './community.service';

interface StationRow {
  id: string;
  official_id: string;
  display_name: string | null;
  brand: string | null;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
}

interface FuelRow {
  code: string;
  label: string;
  price_milli_eur: number | null;
  availability: string;
  source_price_updated_at: Date | null;
}

@Injectable()
export class StationsService {
  private readonly department = getConfig().FUEL_DATASET_DEPARTMENT;

  constructor(private readonly db: DatabaseService, private readonly queues: QueueService, private readonly community: CommunityService) {}

  async list() {
    const { rows } = await this.db.pool.query<StationRow & { available_fuels: string[] }>(
      `SELECT id, official_id, display_name, brand, address, city,
              ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
              ARRAY(SELECT ft.code FROM station_fuels sf
                    JOIN fuel_types ft ON ft.id = sf.fuel_type_id
                    WHERE sf.station_id = stations.id AND sf.availability = 'AVAILABLE'
                    ORDER BY ft.sort_order) AS available_fuels
       FROM stations
       WHERE department_code = $1 AND last_seen_at >= now() - interval '24 hours'
       ORDER BY city NULLS LAST, official_id`,
      [this.department],
    );
    const lastImport = await this.db.pool.query<{ updated_at: Date | null }>(
      `SELECT max(finished_at) AS updated_at FROM import_runs WHERE status = 'SUCCESS'`,
    );
    return {
      updatedAt: lastImport.rows[0].updated_at?.toISOString() ?? null,
      stations: rows.map((row) => ({
        id: row.id,
        displayName: row.display_name ?? 'Station-service',
        brand: row.brand,
        address: row.address,
        city: row.city,
        lat: Number(row.lat),
        lng: Number(row.lng),
        availableFuels: row.available_fuels,
      })),
    };
  }

  async detail(id: string, reporterId?: string) {
    const stationResult = await this.db.pool.query<StationRow & { last_seen_at: Date }>(
      `SELECT id, official_id, display_name, brand, address, city, last_seen_at,
              ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
       FROM stations
       WHERE id = $1 AND department_code = $2 AND last_seen_at >= now() - interval '24 hours'`,
      [id, this.department],
    );
    const station = stationResult.rows[0];
    if (!station) throw new NotFoundException('Station introuvable');

    const fuels = await this.db.pool.query<FuelRow>(
      `SELECT ft.code, ft.label, sf.price_milli_eur, sf.availability, sf.source_price_updated_at
       FROM fuel_types ft
       LEFT JOIN station_fuels sf ON sf.fuel_type_id = ft.id AND sf.station_id = $1
       ORDER BY ft.sort_order`,
      [id],
    );
    return {
      id: station.id,
      officialId: station.official_id,
      lastSyncedAt: station.last_seen_at.toISOString(),
      queue: await this.queues.aggregate(id, reporterId),
      community: await this.community.aggregate(id, reporterId),
      displayName: station.display_name ?? 'Station-service',
      brand: station.brand,
      address: station.address,
      city: station.city,
      location: { lat: Number(station.lat), lng: Number(station.lng) },
      fuels: fuels.rows.map((fuel) => ({
        code: fuel.code,
        label: fuel.label,
        priceMilliEur: fuel.price_milli_eur,
        availability: fuel.availability ?? 'UNKNOWN',
        sourceUpdatedAt: fuel.source_price_updated_at?.toISOString() ?? null,
      })),
    };
  }
}
