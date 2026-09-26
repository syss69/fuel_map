import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { getConfig } from '../config';

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

  constructor(private readonly db: DatabaseService) {}

  async list() {
    const { rows } = await this.db.pool.query<StationRow>(
      `SELECT id, official_id, display_name, brand, address, city,
              ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
       FROM stations
       WHERE department_code = $1 AND last_seen_at >= now() - interval '24 hours'
       ORDER BY city NULLS LAST, official_id`,
      [this.department],
    );
    return {
      stations: rows.map((row) => ({
        id: row.id,
        displayName: row.display_name ?? 'Station-service',
        brand: row.brand,
        lat: Number(row.lat),
        lng: Number(row.lng),
      })),
    };
  }

  async detail(id: string) {
    const stationResult = await this.db.pool.query<StationRow>(
      `SELECT id, official_id, display_name, brand, address, city,
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
