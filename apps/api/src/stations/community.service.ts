import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service';
import { getConfig } from '../config';

export const confirmationSchema = z.object({ reporterId: z.string().uuid() }).strict();
export const fuelReportsSchema = confirmationSchema.extend({
  fuels: z.array(z.object({
    fuelCode: z.enum(['GAZOLE', 'SP95', 'SP98', 'E10', 'E85', 'GPLC']),
    availability: z.enum(['AVAILABLE', 'UNAVAILABLE']).optional(),
    priceMilliEur: z.number().int().positive().max(2147483647).optional(),
  }).strict().refine(f => f.availability !== undefined || f.priceMilliEur !== undefined))
    .min(1).max(6).refine(fuels => new Set(fuels.map(f => f.fuelCode)).size === fuels.length),
}).strict();
type FuelReport = z.infer<typeof fuelReportsSchema>['fuels'][number];

export function normalizedAvailability(value: string | null) {
  if (value === 'AVAILABLE') return 'AVAILABLE';
  if (['UNAVAILABLE', 'TEMPORARILY_UNAVAILABLE', 'PERMANENTLY_UNAVAILABLE'].includes(value ?? '')) return 'UNAVAILABLE';
  return null;
}

@Injectable()
export class CommunityService {
  constructor(private readonly db: DatabaseService) {}

  async aggregate(stationId: string, reporterId?: string, client?: PoolClient) {
    const { rows } = await (client ?? this.db.pool).query(`
      WITH active AS (
        SELECT r.*, ft.code, ft.sort_order, sf.price_milli_eur AS official_price,
          CASE WHEN sf.availability = 'AVAILABLE' THEN 'AVAILABLE'
            WHEN sf.availability IN ('UNAVAILABLE','TEMPORARILY_UNAVAILABLE','PERMANENTLY_UNAVAILABLE') THEN 'UNAVAILABLE'
            ELSE NULL END AS official_availability
        FROM fuel_change_reports r JOIN fuel_types ft ON ft.id = r.fuel_type_id
        LEFT JOIN station_fuels sf ON sf.station_id = r.station_id AND sf.fuel_type_id = r.fuel_type_id
        WHERE r.station_id = $1 AND r.expires_at > now()
      ), availability_votes AS (
        SELECT code, reported_availability AS value, count(*)::int AS votes, max(updated_at) AS latest,
          row_number() OVER (PARTITION BY code ORDER BY count(*) DESC, max(updated_at) DESC, reported_availability ASC) AS rank
        FROM active WHERE reported_availability IS NOT NULL AND reported_availability::text IS DISTINCT FROM official_availability
        GROUP BY code, reported_availability
      ), price_votes AS (
        SELECT code, reported_price_milli_eur AS value, count(*)::int AS votes, max(updated_at) AS latest,
          row_number() OVER (PARTITION BY code ORDER BY count(*) DESC, max(updated_at) DESC, reported_price_milli_eur ASC) AS rank
        FROM active WHERE reported_price_milli_eur IS NOT NULL AND reported_price_milli_eur IS DISTINCT FROM official_price
        GROUP BY code, reported_price_milli_eur
      ), discrepancies AS (
        SELECT ft.sort_order, ft.code AS "fuelCode",
          CASE WHEN a.code IS NOT NULL THEN json_build_object('value', a.value, 'reportsCount', a.votes, 'lastReportedAt', a.latest) END AS availability,
          CASE WHEN p.code IS NOT NULL THEN json_build_object('valueMilliEur', p.value, 'reportsCount', p.votes, 'lastReportedAt', p.latest) END AS price
        FROM fuel_types ft LEFT JOIN availability_votes a ON a.code = ft.code AND a.rank = 1
        LEFT JOIN price_votes p ON p.code = ft.code AND p.rank = 1
        WHERE a.code IS NOT NULL OR p.code IS NOT NULL
      ), confirmations AS (
        SELECT reporter_id FROM station_data_confirmations WHERE station_id = $1 AND expires_at > now()
      )
      SELECT (SELECT count(*)::int FROM confirmations) AS "confirmationsCount",
        EXISTS(SELECT 1 FROM confirmations WHERE reporter_id = $2::uuid) AS "myConfirmationActive",
        EXISTS(SELECT 1 FROM discrepancies) AS "hasDiscrepancies",
        COALESCE((SELECT json_agg(json_build_object('fuelCode', "fuelCode", 'availability', availability, 'price', price) ORDER BY sort_order) FROM discrepancies), '[]'::json) AS "fuelDiscrepancies"
    `, [stationId, reporterId ?? null]);
    return rows[0];
  }

  async confirm(stationId: string, reporterId: string) {
    return this.write(stationId, reporterId, async client => {
      await client.query(`INSERT INTO station_data_confirmations (station_id, reporter_id) VALUES ($1,$2)
        ON CONFLICT (station_id, reporter_id) DO UPDATE SET updated_at=now(), expires_at=now()+interval '3 hours'`, [stationId, reporterId]);
      await client.query(`UPDATE fuel_change_reports SET expires_at=now()
        WHERE station_id=$1 AND reporter_id=$2 AND expires_at>now()`, [stationId, reporterId]);
    });
  }

  async report(stationId: string, reporterId: string, fuels: FuelReport[]) {
    return this.write(stationId, reporterId, async client => {
      const { rows } = await client.query<{ id: number; code: string; price_milli_eur: number | null; availability: string | null }>(
        `SELECT ft.id, ft.code, sf.price_milli_eur, sf.availability FROM fuel_types ft
         LEFT JOIN station_fuels sf ON sf.fuel_type_id=ft.id AND sf.station_id=$1`, [stationId]);
      const changes = fuels.map(fuel => {
        const official = rows.find(row => row.code === fuel.fuelCode);
        if (!official) throw new BadRequestException('Carburant inconnu');
        return {
          id: official.id,
          price: fuel.priceMilliEur !== undefined && fuel.priceMilliEur !== official.price_milli_eur ? fuel.priceMilliEur : null,
          availability: fuel.availability !== undefined && fuel.availability !== normalizedAvailability(official.availability) ? fuel.availability : null,
        };
      }).filter(fuel => fuel.price !== null || fuel.availability !== null);
      if (!changes.length) throw new BadRequestException('Aucune différence avec les informations officielles actuelles.');
      for (const fuel of changes) {
        await client.query(`INSERT INTO fuel_change_reports (station_id, fuel_type_id, reporter_id, reported_price_milli_eur, reported_availability)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT (station_id, fuel_type_id, reporter_id) DO UPDATE SET
          reported_price_milli_eur=EXCLUDED.reported_price_milli_eur, reported_availability=EXCLUDED.reported_availability,
          updated_at=now(), expires_at=now()+interval '3 hours'`, [stationId, fuel.id, reporterId, fuel.price, fuel.availability]);
      }
      await client.query(`UPDATE station_data_confirmations SET expires_at=now()
        WHERE station_id=$1 AND reporter_id=$2 AND expires_at>now()`, [stationId, reporterId]);
    });
  }

  private async write(stationId: string, reporterId: string, action: (client: PoolClient) => Promise<void>) {
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const station = await client.query(`SELECT id FROM stations WHERE id=$1 AND department_code=$2
        AND last_seen_at>=now()-interval '24 hours' FOR UPDATE`, [stationId, getConfig().FUEL_DATASET_DEPARTMENT]);
      if (!station.rowCount) throw new NotFoundException('Station introuvable');
      // The official importer also locks the station before updating its fuel rows.
      await action(client);
      const result = await this.aggregate(stationId, reporterId, client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}
