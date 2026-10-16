import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service';
import { getConfig } from '../config';
import { AdminRateLimiter } from './admin-auth.service';

export const nameSchema = z.string().trim().min(2).max(120);
export const suggestionSchema = z.object({ reporterId: z.string().uuid(), name: nameSchema, comment: z.string().trim().max(1000).optional() }).strict();
export const renameSchema = z.object({ name: nameSchema, expectedName: z.string().nullable() }).strict();
export const reviewSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APPROVED'), name: nameSchema, expectedName: z.string().nullable(), reason: z.string().trim().max(1000).optional() }).strict(),
  z.object({ decision: z.literal('REJECTED'), expectedName: z.string().nullable(), reason: z.string().trim().max(1000).optional() }).strict(),
]);
export const listSchema = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'), page: z.coerce.number().int().min(1).max(100000).default(1) }).strict();
export const searchSchema = z.object({ q: z.string().trim().max(120).default(''), page: z.coerce.number().int().min(1).max(100000).default(1) }).strict();

@Injectable()
export class StationNamesService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService, @Inject(AdminRateLimiter) private readonly limits: AdminRateLimiter) {}
  private async transaction<T>(action: (client: PoolClient) => Promise<T>) {
    const client = await this.db.pool.connect();
    try { await client.query('BEGIN'); const result = await action(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async suggest(id: string, data: z.infer<typeof suggestionSchema>, ip: string) {
    await this.limits.consume('name-reporter', data.reporterId, 5, 3600);
    await this.limits.consume('name-ip', ip, 20, 3600);
    return this.transaction(async client => {
      const station = (await client.query(`SELECT display_name FROM stations WHERE id=$1 AND department_code=$2
        AND last_seen_at>=now()-interval '24 hours' FOR UPDATE`, [id, getConfig().FUEL_DATASET_DEPARTMENT])).rows[0];
      if (!station) throw new NotFoundException('Station introuvable.');
      if (data.name === (station.display_name ?? 'Station-service')) throw new BadRequestException('Le nom proposé est identique au nom actuel.');
      const result = await client.query(`INSERT INTO station_name_suggestions(station_id,reporter_id,proposed_name,comment,original_name)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(station_id,reporter_id) WHERE status='PENDING' DO NOTHING RETURNING id`,
      [id, data.reporterId, data.name, data.comment || null, station.display_name]);
      if (!result.rowCount) throw new ConflictException('Votre proposition pour cette station attend déjà un examen.');
      return { ok: true };
    });
  }
  async suggestions(status: string, page: number) {
    const result = await this.db.pool.query(`SELECT n.id,n.station_id,n.proposed_name,n.comment,n.original_name,n.status,n.created_at,
      n.reviewed_at,n.reviewed_by,n.decision_reason,n.approved_name,s.display_name,s.address,s.city,s.official_id
      FROM station_name_suggestions n JOIN stations s ON s.id=n.station_id WHERE n.status=$1
      ORDER BY n.created_at DESC,n.id LIMIT 26 OFFSET $2`, [status, (page - 1) * 25]);
    return { items: result.rows.slice(0, 25), hasMore: result.rows.length > 25 };
  }
  async stations(q: string, page: number) {
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const result = await this.db.pool.query(`SELECT id,official_id,display_name,address,city,last_seen_at,name_managed_by_admin
      FROM stations WHERE concat_ws(' ',display_name,address,city,official_id) ILIKE $1
      ORDER BY city NULLS LAST,official_id LIMIT 26 OFFSET $2`, [pattern, (page - 1) * 25]);
    return { items: result.rows.slice(0, 25), hasMore: result.rows.length > 25 };
  }
  async history(id: string, page: number) {
    if (!(await this.db.pool.query('SELECT 1 FROM stations WHERE id=$1', [id])).rowCount) throw new NotFoundException('Station introuvable.');
    const result = await this.db.pool.query(`SELECT id,old_name,new_name,admin_username,suggestion_id,created_at FROM station_name_history
      WHERE station_id=$1 ORDER BY created_at DESC,id LIMIT 26 OFFSET $2`, [id, (page - 1) * 25]);
    return { items: result.rows.slice(0, 25), hasMore: result.rows.length > 25 };
  }
  private async lockStation(client: PoolClient, id: string, expectedName: string | null) {
    const station = (await client.query('SELECT display_name FROM stations WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!station) throw new NotFoundException('Station introuvable.');
    if (station.display_name !== expectedName) throw new ConflictException('Le nom a changé. Actualisez avant de continuer.');
    return station.display_name as string | null;
  }
  private async publish(client: PoolClient, id: string, oldName: string | null, name: string, admin: string, suggestionId: string | null) {
    await client.query('UPDATE stations SET display_name=$2,name_managed_by_admin=true,updated_at=now() WHERE id=$1', [id, name]);
    await client.query(`INSERT INTO station_name_history(station_id,old_name,new_name,admin_username,suggestion_id)
      VALUES($1,$2,$3,$4,$5)`, [id, oldName, name, admin, suggestionId]);
  }
  async rename(id: string, data: z.infer<typeof renameSchema>, admin: string) {
    return this.transaction(async client => {
      const oldName = await this.lockStation(client, id, data.expectedName);
      if (data.name === (oldName ?? 'Station-service')) throw new BadRequestException('Le nom est inchangé.');
      await this.publish(client, id, oldName, data.name, admin, null);
      return { ok: true };
    });
  }
  async review(id: string, data: z.infer<typeof reviewSchema>, admin: string) {
    return this.transaction(async client => {
      const suggestion = (await client.query('SELECT station_id FROM station_name_suggestions WHERE id=$1', [id])).rows[0];
      if (!suggestion) throw new NotFoundException('Proposition introuvable.');
      // All name writes lock the station before the suggestion, avoiding inverted lock order.
      const oldName = await this.lockStation(client, suggestion.station_id, data.expectedName);
      const current = (await client.query('SELECT status FROM station_name_suggestions WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (current.status !== 'PENDING') throw new ConflictException('Cette proposition a déjà été examinée.');
      if (data.decision === 'APPROVED') await this.publish(client, suggestion.station_id, oldName, data.name, admin, id);
      await client.query(`UPDATE station_name_suggestions SET status=$2,reviewed_at=now(),reviewed_by=$3,decision_reason=$4,approved_name=$5 WHERE id=$1`,
        [id, data.decision, admin, data.reason || null, data.decision === 'APPROVED' ? data.name : null]);
      return { ok: true };
    });
  }
}
