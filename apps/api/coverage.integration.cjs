// Real PostgreSQL, rollback-only fixtures, no scheduled workers or external senders.
require('reflect-metadata');
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
process.env.FUEL_DATASET_DEPARTMENTS = '40,64,65';
process.env.RESEND_API_KEY = 'test-only'; process.env.DIGEST_TOKEN_SECRET = 'test-only-secret'.repeat(4); process.env.DIGEST_ENABLED = 'true';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { parseDepartments } = require('./dist/config');
const { OpenDataFuelProvider } = require('./dist/imports/providers/open-data-fuel.provider');
const { OpenDataStationMapper } = require('./dist/imports/mappers/open-data-station.mapper');
const { FuelImportService } = require('./dist/imports/fuel-import.service');
const { StationsService } = require('./dist/stations/stations.service');
const { QueueService } = require('./dist/stations/queue.service');
const { CommunityService } = require('./dist/stations/community.service');
const { StationNamesService } = require('./dist/admin/station-names.service');
const { AdminRateLimiter } = require('./dist/admin/admin-auth.service');
const { AlertsService } = require('./dist/alerts/alerts.service');
const { DigestService } = require('./dist/digest/digest.service');

(async () => {
  assert.deepEqual(parseDepartments(), ['64']); assert.deepEqual(parseDepartments(undefined, '65'), ['65']);
  assert.deepEqual(parseDepartments('40, 64,65,40', '66'), ['40', '64', '65']);
  for (const value of ['', '64,', '0', '999', '64" OR true', '20']) assert.throws(() => parseDepartments(value));
  const oldFetch = global.fetch; let requests = 0;
  try {
    global.fetch = async input => {
      requests++;
      assert.equal(new URL(input).searchParams.get('where'), 'code_departement="40" OR code_departement="64" OR code_departement="65"');
      return new Response(JSON.stringify([{ id: 'provider-test' }]), { status: 200 });
    };
    await new OpenDataFuelProvider().fetchStations(); assert.equal(requests, 1);
  } finally { global.fetch = oldFetch; }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL }), c = await pool.connect();
  try {
    await c.query('BEGIN');
    const query = (sql, args) => c.query(sql === 'BEGIN' ? 'SAVEPOINT coverage' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT coverage' : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT coverage' : sql, args);
    const proxy = { query, release() {} }, db = { pool: { query, connect: async () => proxy } };
    const mapper = new OpenDataStationMapper();
    // Remote island coordinates keep digest fixtures independent of existing local stations.
    const fixtures = ['40', '64', '65', '66'].map((code, i) => mapper.map({ id: `coverage-${randomUUID()}`, code_departement: code, cp: `${code}000`, adresse: 'Test', ville: 'Test',
      geom: { lon: -30 + i * .001, lat: code === '66' ? 31 : 30 }, carburants_disponibles: ['Gazole'], gazole_prix: 1.899 }));
    const stats = () => ({ recordsReceived: 4, recordsValid: 4, recordsInvalid: 0, stationsCreated: 0, stationsMetadataUpdated: 0, fuelStatesChanged: 0, historyRowsCreated: 0 });
    const importer = new FuelImportService(db, { fetchStations: async () => [] }, mapper);
    const first = stats(); await importer.synchronize(proxy, fixtures, first); assert.equal(first.stationsCreated, 4);
    const ids = (await c.query('SELECT id,department_code FROM stations WHERE official_id=ANY($1::text[]) ORDER BY department_code', [fixtures.map(s => s.officialId)])).rows;
    const [s40, s64, s65, s66] = ids.map(s => s.id);
    await c.query("UPDATE stations SET display_name='Protected',name_managed_by_admin=true WHERE id=$1", [s65]);
    const repeat = stats(); await importer.synchronize(proxy, fixtures, repeat); assert.equal(repeat.stationsCreated, 0); assert.equal(repeat.fuelStatesChanged, 0);
    assert.equal((await c.query('SELECT count(*)::int n FROM stations WHERE official_id=ANY($1::text[])', [fixtures.map(s => s.officialId)])).rows[0].n, 4);
    const queue = new QueueService(db), community = new CommunityService(db), stations = new StationsService(db, queue, community);
    const visible = (await stations.list()).stations.map(s => s.id);
    assert.ok(visible.includes(s40) && visible.includes(s64) && visible.includes(s65) && !visible.includes(s66));
    assert.equal((await stations.detail(s65)).displayName, 'Protected'); await assert.rejects(stations.detail(s66), /introuvable/);
    const reporter = randomUUID(); await queue.report(s40, reporter, 'LT_5'); assert.equal((await queue.aggregate(s40)).status, 'LT_5');
    await community.confirm(s40, reporter); await community.report(s40, reporter, [{ fuelCode: 'GAZOLE', priceMilliEur: 1800 }]);
    assert.equal((await community.aggregate(s40, reporter)).hasDiscrepancies, true);
    const names = new StationNamesService(db, new AdminRateLimiter(db));
    await names.suggest(s40, { reporterId: reporter, name: 'Corrected' }, randomUUID());
    await assert.rejects(queue.report(s66, reporter, 'NONE'), /introuvable/);
    await assert.rejects(community.confirm(s66, reporter), /introuvable/);
    await assert.rejects(names.suggest(s66, { reporterId: reporter, name: 'Other' }, randomUUID()), /introuvable/);
    const subscriber = (await c.query('INSERT INTO subscribers(email,email_verified_at) VALUES($1,now()) RETURNING id', [`coverage-${randomUUID()}@example.test`])).rows[0];
    const alerts = new AlertsService(db);
    await alerts.save(subscriber.id, { stationId: s40, fuelCode: 'GAZOLE', eventType: 'FUEL_AVAILABLE', frequency: 'RECURRING', status: 'ACTIVE' });
    assert.equal((await alerts.list(subscriber.id)).length, 1);
    const digest = new DigestService(db, { send: async () => { throw new Error('No external emails'); } });
    const subscription = (await c.query(`INSERT INTO digest_subscriptions(email,fuel_type_id,center,radius_meters,unsubscribe_token_hash,unsubscribe_nonce,favorite_station_id)
      SELECT email,(SELECT id FROM fuel_types WHERE code='GAZOLE'),ST_SetSRID(ST_MakePoint(-30,30),4326)::geography,5000,$2,$3,$4 FROM subscribers WHERE id=$1 RETURNING id`, [subscriber.id, randomUUID(), randomUUID(), s40])).rows[0];
    const snapshot = await digest.snapshot(proxy, subscription.id, '2026-10-16');
    assert.equal(snapshot.favorite.id, s40); assert.ok(snapshot.top.some(s => s.id === s40)); assert.ok(snapshot.top.some(s => s.id === s64)); assert.ok(snapshot.top.some(s => s.id === s65));
    await c.query("UPDATE stations SET last_seen_at=now()-interval '24 hours 1 second' WHERE id=$1", [s40]);
    assert.ok(!(await stations.list()).stations.some(s => s.id === s40));
    await assert.rejects(stations.detail(s40), /introuvable/); await assert.rejects(queue.report(s40, reporter, 'NONE'), /introuvable/);
    console.log('Coverage checks passed: config precedence, single union request, idempotent import, name preservation, 40/64/65 public actions, freshness, alerts and cross-department digest. Fixtures rolled back.');
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
