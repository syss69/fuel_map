import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { getConfig } from '../config';

export type QueueStatus = 'NONE' | 'LT_5' | 'FROM_5_TO_10' | 'FROM_11_TO_15' | 'GT_15';

@Injectable()
export class QueueService {
  constructor(private readonly db: DatabaseService) {}

  async aggregate(stationId: string, reporterId?: string, client?: PoolClient) {
    const { rows } = await (client ?? this.db.pool).query(
      `WITH active AS (
         SELECT queue_status, updated_at, reporter_id, id FROM queue_reports
         WHERE station_id = $1 AND expires_at > now()
       ), winner AS (
         SELECT queue_status, count(*)::int AS votes, max(updated_at) AS latest
         FROM active GROUP BY queue_status
         ORDER BY count(*) DESC, max(updated_at) DESC, queue_status ASC LIMIT 1
       )
       SELECT
         (SELECT queue_status FROM winner) AS status,
         (SELECT count(*)::int FROM active) AS "reportsCount",
         COALESCE((SELECT votes FROM winner), 0) AS "confirmationsCount",
         (SELECT max(updated_at) FROM active) AS "lastReportedAt",
         (SELECT latest FROM winner) AS "statusLastReportedAt",
         (SELECT json_build_object('status', queue_status, 'updatedAt', updated_at)
          FROM active ORDER BY updated_at DESC, queue_status ASC, id ASC LIMIT 1) AS "latestReport",
         (SELECT json_build_object('status', queue_status, 'updatedAt', updated_at)
          FROM active WHERE reporter_id = $2::uuid) AS "myReport"`,
      [stationId, reporterId ?? null],
    );
    return rows[0];
  }

  async report(stationId: string, reporterId: string, status: QueueStatus) {
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const station = await client.query(
        `SELECT id FROM stations WHERE id = $1 AND department_code = $2
         AND last_seen_at >= now() - interval '24 hours' FOR UPDATE`,
        [stationId, getConfig().FUEL_DATASET_DEPARTMENT],
      );
      if (!station.rowCount) throw new NotFoundException('Station introuvable');
      await client.query(
        `INSERT INTO queue_reports (station_id, reporter_id, queue_status)
         VALUES ($1, $2, $3)
         ON CONFLICT (station_id, reporter_id) DO UPDATE SET
           queue_status = EXCLUDED.queue_status, updated_at = now(),
           expires_at = now() + interval '45 minutes'`,
        [stationId, reporterId, status],
      );
      const result = await this.aggregate(stationId, reporterId, client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
