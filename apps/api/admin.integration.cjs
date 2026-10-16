// Build first, apply migrations, then npm run test:admin. All test data is rolled back.
require('reflect-metadata');
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
const { hashPassword, verifyPassword } = require('./dist/admin/password');

(async () => {
  process.env.ADMIN_USERNAME = 'integration-admin';
  process.env.ADMIN_PASSWORD_HASH = await hashPassword('integration-only-password');
  const { getConfig } = require('./dist/config');
  const { DatabaseService } = require('./dist/database/database.service');
  const { AdminAuthService, AdminRateLimiter, AdminGuard } = require('./dist/admin/admin-auth.service');
  const { StationNamesService, suggestionSchema, reviewSchema } = require('./dist/admin/station-names.service');
  const { AdminController, AdminLoginController, NameSuggestionsController } = require('./dist/admin/admin.module');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let app;
  try {
    await client.query('BEGIN');
    const proxy = {
      query: (sql, args) => client.query(sql === 'BEGIN' ? 'SAVEPOINT name_write' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT name_write' : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT name_write' : sql, args),
      release() {},
    };
    const db = { pool: { connect: async () => proxy, query: client.query.bind(client) } };
    const limits = new AdminRateLimiter(db), auth = new AdminAuthService(db, limits), names = new StationNamesService(db, limits);
    const station = randomUUID(), reporter = randomUUID(), ip = randomUUID();
    await client.query(`INSERT INTO stations(id,official_id,display_name,department_code,location,last_seen_at)
      VALUES($1,$2,'Original',$3,ST_SetSRID(ST_MakePoint(-0.3,43),4326)::geography,now())`, [station, `admin-test-${station}`, getConfig().FUEL_DATASET_DEPARTMENT]);
    await client.query(`INSERT INTO station_fuels(station_id,fuel_type_id,availability) SELECT $1,id,'AVAILABLE' FROM fuel_types`, [station]);
    await client.query(`INSERT INTO queue_reports(station_id,reporter_id,queue_status) VALUES($1,$2,'NONE')`, [station, reporter]);
    const fuels = (await client.query('SELECT * FROM station_fuels WHERE station_id=$1 ORDER BY fuel_type_id', [station])).rows;
    const queues = (await client.query('SELECT * FROM queue_reports WHERE station_id=$1', [station])).rows;
    assert.equal(await verifyPassword('incorrect', process.env.ADMIN_PASSWORD_HASH), false);
    assert.equal(await verifyPassword('integration-only-password', process.env.ADMIN_PASSWORD_HASH), true);
    for (const body of [{}, { reporterId: 'bad', name: 'New' }, { reporterId: reporter, name: ' ' }, { reporterId: reporter, name: 'x'.repeat(121) }, { reporterId: reporter, name: 'New', extra: true }]) assert.equal(suggestionSchema.safeParse(body).success, false);
    assert.equal(reviewSchema.safeParse({ decision: 'APPROVED', expectedName: null }).success, false);
    await assert.rejects(names.suggest(station, { reporterId: reporter, name: 'Original' }, ip), /identique/);
    await names.suggest(station, { reporterId: reporter, name: '<script>New & name</script>', comment: '<img src=x>' }, ip);
    assert.equal((await client.query('SELECT display_name FROM stations WHERE id=$1', [station])).rows[0].display_name, 'Original');
    await assert.rejects(names.suggest(station, { reporterId: reporter, name: 'Another' }, ip), /attend déjà/);
    const pending = (await names.suggestions('PENDING', 1)).items.find(row => row.station_id === station);
    assert.ok(pending); assert.equal('reporter_id' in pending, false);
    await assert.rejects(names.review(pending.id, { decision: 'APPROVED', name: 'Edited', expectedName: 'stale' }, 'admin'), /a changé/);
    await names.review(pending.id, { decision: 'APPROVED', name: 'Edited', expectedName: 'Original' }, 'admin');
    await assert.rejects(names.review(pending.id, { decision: 'REJECTED', expectedName: 'Edited' }, 'admin'), /déjà été/);
    assert.equal((await names.history(station, 1)).items[0].suggestion_id, pending.id);
    // Exact override statement used by the CLI: name is protected, brand still changes.
    const cli = require('node:fs').readFileSync(require('node:path').join(__dirname, 'src/cli/apply-overrides.ts'), 'utf8');
    const overrideSql = cli.match(/`(UPDATE stations SET[^`]+)`/)[1];
    await client.query(overrideSql, [`admin-test-${station}`, 'JSON old name', 'Brand']);
    let row = (await client.query('SELECT * FROM stations WHERE id=$1', [station])).rows[0];
    assert.equal(row.display_name, 'Edited'); assert.equal(row.brand, 'Brand'); assert.equal(row.name_managed_by_admin, true);
    await names.suggest(station, { reporterId: reporter, name: 'Second' }, ip);
    const second = (await names.suggestions('PENDING', 1)).items.find(row => row.station_id === station);
    await names.review(second.id, { decision: 'REJECTED', expectedName: 'Edited', reason: 'Non vérifié' }, 'admin');
    assert.equal((await names.history(station, 1)).items.length, 1);
    await names.rename(station, { name: 'Direct', expectedName: 'Edited' }, 'admin');
    await assert.rejects(names.rename(station, { name: 'Lost update', expectedName: 'Edited' }, 'admin'), /a changé/);
    assert.equal((await names.history(station, 1)).items.length, 2);
    assert.ok((await names.stations(`admin-test-${station}`, 1)).items.some(s => s.id === station));
    assert.deepEqual((await client.query('SELECT * FROM station_fuels WHERE station_id=$1 ORDER BY fuel_type_id', [station])).rows, fuels);
    assert.deepEqual((await client.query('SELECT * FROM queue_reports WHERE station_id=$1', [station])).rows, queues);
    await client.query(`UPDATE stations SET last_seen_at=now()-interval '2 days' WHERE id=$1`, [station]);
    await assert.rejects(names.suggest(station, { reporterId: randomUUID(), name: 'Missing' }, randomUUID()), /introuvable/);
    assert.ok((await names.stations(`admin-test-${station}`, 1)).items.length);
    await names.rename(station, { name: 'Stale station edit', expectedName: 'Direct' }, 'admin');

    // Exercise real row-lock contention on an existing committed station, without committing changes.
    const existing = (await client.query('SELECT id,display_name FROM stations WHERE id<>$1 LIMIT 1', [station])).rows[0];
    if (!existing) throw new Error('Seed/import at least one station before running concurrency checks.');
    const blocker = await pool.connect();
    try {
      const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const reviewId = (await client.query(`INSERT INTO station_name_suggestions(station_id,reporter_id,proposed_name,original_name)
        VALUES($1,$2,'Concurrency test',$3) RETURNING id`, [existing.id, randomUUID(), existing.display_name])).rows[0].id;
      for (const operation of [
        () => names.rename(existing.id, { name: 'Concurrency test', expectedName: existing.display_name }, 'admin'),
        () => names.review(reviewId, { decision: 'APPROVED', name: 'Concurrency test', expectedName: existing.display_name }, 'admin'),
      ]) {
        await client.query('SAVEPOINT concurrency');
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM stations WHERE id=$1 FOR NO KEY UPDATE', [existing.id]);
        let completed = false;
        const pending = operation().finally(() => { completed = true; });
        try {
          let waiting = false;
          for (let i = 0; i < 100; i++) {
            if ((await blocker.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'", [pid])).rowCount) { waiting = true; break; }
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          assert.ok(waiting, 'Name writes must wait for the station row lock'); assert.equal(completed, false);
        } finally { await blocker.query('ROLLBACK'); await pending; }
        await client.query('ROLLBACK TO SAVEPOINT concurrency');
      }
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }

    const limitKey = randomUUID();
    for (let i = 0; i < 5; i++) await limits.consume('test', limitKey, 5, 900);
    await assert.rejects(limits.consume('test', limitKey, 5, 900), e => e.getStatus() === 429);
    await client.query('UPDATE admin_rate_limits SET expires_at=now() WHERE key=$1', [require('node:crypto').createHash('sha256').update(`test:${limitKey}`).digest('hex')]);
    await limits.consume('test', limitKey, 5, 900);
    await assert.rejects(auth.login('integration-admin', 'bad', randomUUID()), e => e.getStatus() === 401);
    const token = await auth.login('integration-admin', 'integration-only-password', randomUUID());
    const cookie = `trajetico_admin=${token}`;
    assert.equal((await auth.current(cookie)).role, 'ADMIN');
    const config = getConfig(), original = config.ADMIN_PASSWORD_HASH;
    config.ADMIN_PASSWORD_HASH = original.slice(0, -1) + (original.endsWith('0') ? '1' : '0');
    await assert.rejects(auth.current(cookie), e => e.getStatus() === 401);
    config.ADMIN_PASSWORD_HASH = original;
    await client.query('UPDATE admin_sessions SET expires_at=now() WHERE username=$1', ['integration-admin']);
    await assert.rejects(auth.current(cookie), e => e.getStatus() === 401);
    const fresh = await auth.login('integration-admin', 'integration-only-password', randomUUID());
    await auth.logout(`trajetico_admin=${fresh}`);
    await assert.rejects(auth.current(`trajetico_admin=${fresh}`), e => e.getStatus() === 401);
    config.ADMIN_USERNAME = undefined;
    await assert.rejects(auth.login('integration-admin', 'integration-only-password', randomUUID()), e => e.getStatus() === 401);
    config.ADMIN_USERNAME = 'integration-admin';

    class TestModule {}
    Module({ controllers: [AdminController, AdminLoginController, NameSuggestionsController], providers: [
      { provide: DatabaseService, useValue: db }, AdminRateLimiter, AdminAuthService, AdminGuard, StationNamesService,
    ] })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const request = (path, method = 'GET', body, cookie, origin = new URL(config.FRONTEND_ORIGIN).origin) => fetch(`${base}/api/v1${path}`, {
      method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    for (const path of ['/admin/session', '/admin/name-suggestions', '/admin/stations', `/admin/stations/${station}/history`]) assert.equal((await request(path)).status, 401);
    assert.equal((await request('/admin/login', 'POST', { username: 'integration-admin', password: 'integration-only-password' }, null, 'https://wrong.example')).status, 403);
    const login = await request('/admin/login', 'POST', { username: 'integration-admin', password: 'integration-only-password' });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/); assert.match(setCookie, /Path=\/api\/v1\/admin/); assert.match(setCookie, /Max-Age=28800/);
    const sessionCookie = setCookie.split(';')[0];
    const session = await request('/admin/session', 'GET', null, sessionCookie);
    assert.equal(session.status, 200); assert.equal(session.headers.get('cache-control'), 'no-store');
    assert.equal((await request('/admin/stations?page=0', 'GET', null, sessionCookie)).status, 400);
    assert.equal((await request('/admin/stations/not-a-uuid/name', 'PUT', { name: 'Test', expectedName: null }, sessionCookie)).status, 400);
    assert.equal((await request(`/admin/stations/${station}/name`, 'PUT', { name: 'No', expectedName: 'Stale station edit' }, sessionCookie, 'https://wrong.example')).status, 403);
    assert.equal((await request('/admin/logout', 'POST', {}, sessionCookie)).status, 200);
    assert.equal((await request('/admin/session', 'GET', null, sessionCookie)).status, 401);
    console.log('Admin integration: auth, HTTP guards, cookies, Origin, moderation, conflicts, overrides, validation and isolation passed. All fixtures rolled back.');
  } finally { if (app) await app.close(); await client.query('ROLLBACK'); client.release(); await pool.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
