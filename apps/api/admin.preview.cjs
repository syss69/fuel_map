// Local UI review only. Real controllers, isolated credentials, no schedulers/senders; all writes roll back.
require('reflect-metadata');
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { hashPassword } = require('./dist/admin/password');
(async () => {
  process.env.ADMIN_USERNAME = 'preview';
  process.env.ADMIN_PASSWORD_HASH = await hashPassword('preview-only-password');
  process.env.FRONTEND_ORIGIN = 'http://127.0.0.1:5175';
  process.env.VITE_API_BASE_URL = 'http://127.0.0.1:3103/api/v1';
  process.env.NODE_ENV = 'development';
  const { DatabaseService } = require('./dist/database/database.service');
  const { AdminAuthService, AdminRateLimiter, AdminGuard } = require('./dist/admin/admin-auth.service');
  const { StationNamesService } = require('./dist/admin/station-names.service');
  const { AdminController, AdminLoginController, NameSuggestionsController } = require('./dist/admin/admin.module');
  const { StationsService } = require('./dist/stations/stations.service');
  const { StationsController } = require('./dist/stations/stations.controller');
  const { QueueService } = require('./dist/stations/queue.service');
  const { CommunityService } = require('./dist/stations/community.service');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL }), c = await pool.connect();
  let app, vite, closing = false;
  const close = async () => { if (closing) return; closing = true; await vite?.close(); await app?.close(); await c.query('ROLLBACK'); c.release(); await pool.end(); process.exit(); };
  process.on('SIGINT', close); process.on('SIGTERM', close); process.stdin.resume(); process.stdin.on('data', close);
  await c.query('BEGIN');
  const proxy = { query: (sql, args) => c.query(sql === 'BEGIN' ? 'SAVEPOINT preview' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT preview' : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT preview' : sql, args), release() {} };
  const db = { pool: { query: proxy.query, connect: async () => proxy } };
  const station = randomUUID();
  await c.query(`INSERT INTO stations(id,official_id,display_name,department_code,location,last_seen_at)
    VALUES($1,$2,'Station de démonstration',$3,ST_SetSRID(ST_MakePoint(-0.3708,43.2951),4326)::geography,now())`, [station, `admin-preview-${station}`, process.env.FUEL_DATASET_DEPARTMENT || '64']);
  await c.query(`INSERT INTO station_fuels(station_id,fuel_type_id,price_milli_eur,availability) SELECT $1,id,1899,'AVAILABLE' FROM fuel_types`, [station]);
  const queues = new QueueService(db), community = new CommunityService(db), stations = new StationsService(db, queues, community);
  const originalList = stations.list.bind(stations);
  stations.list = async () => { const list = await originalList(); return { ...list, stations: list.stations.filter(s => s.id === station) }; };
  class PreviewModule {}
  Module({ controllers: [AdminController, AdminLoginController, NameSuggestionsController, StationsController], providers: [
    { provide: DatabaseService, useValue: db }, AdminRateLimiter, AdminAuthService, AdminGuard, StationNamesService,
    { provide: StationsService, useValue: stations }, { provide: QueueService, useValue: queues }, { provide: CommunityService, useValue: community },
  ] })(PreviewModule);
  app = await NestFactory.create(PreviewModule, { logger: false });
  // Serialize preview requests because they share a single rollback transaction.
  let tail = Promise.resolve();
  app.use((req, res, next) => { const prior = tail; tail = new Promise(resolve => { res.once('finish', resolve); res.once('close', resolve); }); prior.then(next); });
  app.enableCors({ origin: process.env.FRONTEND_ORIGIN, credentials: true });
  await app.listen(3103, '127.0.0.1');
  const { createServer } = await import('vite'), { default: react } = await import('@vitejs/plugin-react');
  vite = await createServer({ root: require('node:path').resolve(__dirname, '../web'), configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 5175, strictPort: true } });
  await vite.listen();
  console.log(`Preview http://127.0.0.1:5175/app?station=${station}\nAdmin http://127.0.0.1:5175/admin — preview / preview-only-password\nPress Enter to roll back and stop.`);
})().catch(error => { console.error(error); process.exit(1); });
