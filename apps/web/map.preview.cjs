// Read-only fixture API and Vite. No database, importer, schedulers, email or push.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const overrides = JSON.parse(fs.readFileSync(path.join(root, 'data/station-overrides.json')));
const rows = [...JSON.parse(fs.readFileSync(path.join(root, 'data/station-names-current.json'))), ...JSON.parse(fs.readFileSync(path.join(root, 'data/station-names-current-65.json'))), ...JSON.parse(fs.readFileSync(path.join(root, 'data/station-names-current-40.json')))];
const stations = rows.map((row, index) => ({ id: randomUUID(), officialId: row.official_id, department: row.department_code || '64', displayName: overrides[row.official_id]?.displayName || row.display_name || 'Station-service',
  brand: null, address: row.address, city: row.city, lat: row.lat, lng: row.lng, availableFuels: index % 4 === 0 ? [] : index % 3 === 0 ? ['SP98'] : ['GAZOLE', 'E10'] }));
const now = new Date().toISOString();
(async () => {
  const api = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5176'); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.end(); return; }
    const url = new URL(req.url, 'http://localhost');
    let result;
    if (req.method !== 'GET') { res.statusCode = 400; result = { message: 'Prévisualisation : aucune donnée enregistrée.' }; }
    else if (url.pathname === '/api/v1/stations') result = { updatedAt: now, stations };
    else if (url.pathname.startsWith('/api/v1/stations/')) {
      const s = stations.find(s => s.id === url.pathname.split('/').at(-1));
      if (!s) { res.statusCode = 404; result = {}; }
      else result = { ...s, location: { lat: s.lat, lng: s.lng }, lastSyncedAt: now,
        fuels: ['GAZOLE', 'SP95', 'SP98', 'E10', 'E85', 'GPLC'].map(code => ({ code, label: code, availability: s.availableFuels.includes(code) ? 'AVAILABLE' : 'UNKNOWN', priceMilliEur: 1899, sourceUpdatedAt: now })),
        queue: { status: null, reportsCount: 0, confirmationsCount: 0, lastReportedAt: null, myReport: null }, community: { confirmationsCount: 0, myConfirmationActive: false, hasDiscrepancies: false, fuelDiscrepancies: [] } };
    } else if (url.pathname === '/api/v1/alerts/me') result = { email: 'preview@example.test', rules: [], devices: [] };
    else if (url.pathname === '/api/v1/alerts/digest') { const s = stations.find(s => s.department === '65'); result = { status: 'ACTIVE', fuelCode: 'E10', lat: s.lat, lng: s.lng, radiusMeters: 10000, weekdays: [1,3,5], favoriteStationId: s.id, favoriteStation: s }; }
    else if (url.pathname === '/api/v1/alerts/config') result = { publicKey: null };
    else { res.statusCode = 404; result = {}; }
    res.end(JSON.stringify(result));
  });
  await new Promise(resolve => api.listen(3104, '127.0.0.1', resolve));
  process.env.VITE_API_BASE_URL = 'http://127.0.0.1:3104/api/v1';
  const { createServer } = await import('vite'), { default: react } = await import('@vitejs/plugin-react');
  const vite = await createServer({ root: __dirname, configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 5176, strictPort: true } });
  await vite.listen();
  console.log(`Read-only preview: http://127.0.0.1:5176/app\nMap checks: http://127.0.0.1:5176/checks/map.html\n65 deep link: http://127.0.0.1:5176/app?station=${stations.find(s => s.department === '65').id}\n${stations.length} stations; Enter to stop.`);
  const close = async () => { await vite.close(); api.close(); process.exit(); };
  process.on('SIGINT', close); process.stdin.resume(); process.stdin.on('data', close);
})().catch(error => { console.error(error); process.exit(1); });
