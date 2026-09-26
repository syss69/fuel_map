// Run after npm run build. All fixtures are rolled back, including service upserts.
require('reflect-metadata');
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { QueueService } = require('./dist/stations/queue.service');
const { StationsController } = require('./dist/stations/stations.controller');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = randomUUID(), reporter = randomUUID();
    await client.query(`INSERT INTO stations (id, official_id, department_code, location, last_seen_at)
      VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint(0, 43), 4326)::geography, now())`,
      [id, `queue-test-${id}`, process.env.FUEL_DATASET_DEPARTMENT || '64']);
    const proxy = { query: (sql, args) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)
      ? Promise.resolve({ rows: [] }) : client.query(sql, args), release() {} };
    const service = new QueueService({ pool: { connect: async () => proxy, query: client.query.bind(client) } });
    let result = await service.aggregate(id, reporter);
    assert.equal(result.status, null);
    assert.equal(result.reportsCount, 0);
    assert.equal(result.myReport, null);
    await service.report(id, reporter, 'NONE');
    await service.report(id, reporter, 'LT_5');
    result = await service.report(id, reporter, 'LT_5');
    assert.equal(result.reportsCount, 1);
    assert.equal(result.myReport.status, 'LT_5');
    const saved = await client.query('SELECT *, expires_at = updated_at + interval \'45 minutes\' AS ttl FROM queue_reports WHERE station_id=$1', [id]);
    assert.equal(saved.rows.length, 1);
    assert.equal(saved.rows[0].ttl, true);
    await client.query(`UPDATE queue_reports SET updated_at=now()-interval '7 minutes' WHERE station_id=$1`, [id]);
    await client.query(`INSERT INTO queue_reports (station_id, reporter_id, queue_status, updated_at)
      VALUES ($1,$2,'LT_5',now()-interval '6 minutes'),($1,$3,'GT_15',now()-interval '1 minute')`, [id, randomUUID(), randomUUID()]);
    result = await service.aggregate(id, reporter);
    assert.equal(result.status, 'LT_5');
    assert.equal(result.confirmationsCount, 2);
    assert.equal(result.reportsCount, 3);
    assert.equal(result.latestReport.status, 'GT_15');
    assert.ok(result.lastReportedAt > result.statusLastReportedAt);
    assert.equal(JSON.stringify(result).includes(reporter), false);
    await client.query(`INSERT INTO queue_reports (station_id, reporter_id, queue_status) VALUES ($1,$2,'GT_15')`, [id, randomUUID()]);
    assert.equal((await service.aggregate(id)).status, 'GT_15');
    await client.query('UPDATE queue_reports SET expires_at=now() WHERE station_id=$1', [id]);
    result = await service.aggregate(id, reporter);
    assert.equal(result.status, null);
    assert.equal(result.reportsCount, 0);
    assert.equal(result.confirmationsCount, 0);
    assert.equal(result.lastReportedAt, null);
    assert.equal(result.myReport, null);
    assert.equal((await service.report(id, reporter, 'NONE')).reportsCount, 1);
    assert.equal((await client.query('SELECT count(*)::int n FROM queue_reports WHERE station_id=$1', [id])).rows[0].n, 4);
    const controller = new StationsController({}, service);
    assert.throws(() => controller.report(id, { reporterId: reporter, status: 'NO_DATA' }));
    assert.throws(() => controller.report(id, { reporterId: 'bad', status: 'NONE' }));
    assert.throws(() => controller.detail(id, 'bad'));
    await assert.rejects(() => service.report(randomUUID(), reporter, 'NONE'), /Station introuvable/);
    console.log('Queue integration checks passed: upsert, TTL, majority, tie, latest, privacy, validation, missing station.');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
