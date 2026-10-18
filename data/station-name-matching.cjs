const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const coordinate = (value, max) => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= max;
function distance(station, candidate) {
  if (!coordinate(station.lat, 90) || !coordinate(station.lng, 180) || !coordinate(candidate.latitude_osm, 90) || !coordinate(candidate.longitude_osm, 180)) return null;
  const rad = Math.PI / 180, lat = (Number(candidate.latitude_osm) - Number(station.lat)) * rad, lng = (Number(candidate.longitude_osm) - Number(station.lng)) * rad;
  const a = Math.sin(lat / 2) ** 2 + Math.cos(Number(station.lat) * rad) * Math.cos(Number(candidate.latitude_osm) * rad) * Math.sin(lng / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}
// RFC4180: quoted commas, escaped quotes and CRLF.
function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (quoted) throw new Error('Unterminated quoted CSV field');
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift();
  if (!headers?.includes('id_station_officiel')) throw new Error('Invalid station reference headers');
  return rows.map(values => Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ''])));
}
function review(stations, reference) {
  const byId = new Map();
  for (const row of reference) { const key = String(row.id_station_officiel); byId.set(key, [...(byId.get(key) || []), row]); }
  const accepted = [], skipped = [];
  for (const station of stations) {
    const candidates = byId.get(String(station.official_id)) || [], candidate = candidates[0], reasons = [];
    if (candidates.length !== 1) reasons.push(candidates.length ? 'Plusieurs correspondances' : 'Absent du référentiel');
    const metres = candidate ? distance(station, candidate) : null;
    if (candidate) {
      if (!normalize(station.address) || normalize(station.address) !== normalize(candidate.adresse)) reasons.push('Adresse différente ou absente');
      if (!normalize(station.city) || normalize(station.city) !== normalize(candidate.ville)) reasons.push('Commune différente ou absente');
      if (!station.postal_code || String(station.postal_code) !== candidate.code_postal) reasons.push('Code postal différent ou absent');
      if (metres === null || metres > 200) reasons.push('Coordonnées éloignées (>200m) ou absentes');
      const name = candidate.nom_normalise?.trim();
      if (!name || name.length < 2 || name.length > 120 || /^(stationservice|station|inconnu|sansnom|independant)$/.test(normalize(name))) reasons.push('Nom générique ou invalide');
    }
    const item = { ...station, candidate: candidate?.nom_normalise?.trim() || null, distanceMeters: metres === null ? null : Math.round(metres * 100) / 100, reasons };
    (reasons.length ? skipped : accepted).push(item);
  }
  return { accepted, skipped };
}
function mergeOverrides(existing, accepted) {
  const merged = structuredClone(existing);
  for (const station of accepted) {
    if (station.name_managed_by_admin || station.display_name || Object.hasOwn(merged, station.official_id)) continue;
    merged[station.official_id] = { displayName: station.candidate };
  }
  return merged;
}
async function main() {
  const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const department = arg('department') || '65';
  if (!/^(40|64|65)$/.test(department)) throw new Error('Use --department=40, --department=64 or --department=65');
  let stations;
  if (arg('stations')) stations = JSON.parse(fs.readFileSync(path.resolve(root, arg('stations')), 'utf8').replace(/^\uFEFF/, ''));
  else {
    require('dotenv').config({ path: path.join(root, '.env') });
    const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try { stations = (await pool.query(`SELECT official_id,display_name,name_managed_by_admin,address,city,postal_code,department_code,ST_Y(location::geometry) AS lat,ST_X(location::geometry) AS lng FROM stations WHERE department_code=$1 ORDER BY official_id`, [department])).rows; }
    finally { await pool.end(); }
  }
  stations = stations.filter(station => station.department_code === department);
  if (!stations.length) throw new Error(`No stations in ${department}. Import fuel data first or supply --stations=...`);
  const reference = parseCsv(fs.readFileSync(path.join(__dirname, 'station-names-source.csv'), 'utf8'));
  const result = review(stations, reference);
  const report = { source: 'https://www.data.gouv.fr/datasets/referentiel-des-noms-et-enseignes-de-stations-service-enrichi-par-openstreetmap',
    referenceFile: 'data/station-names-source.csv', referenceSnapshot: '2026-09-27', reviewedAt: new Date().toISOString(), department,
    license: 'ODbL', credit: '© OpenStreetMap contributors; enrichment by Chiffrex',
    criteria: 'Unique official ID, identical nonempty normalized address/city, identical postcode, valid coordinates, distance <=200m, non-generic name; existing names preserved', ...result };
  fs.writeFileSync(path.join(__dirname, `station-names-review-${department}.json`), JSON.stringify(report, null, 2) + '\n');
  const lines = result.skipped.map(s => `- ${s.official_id} — ${s.address}, ${s.city}\n  Candidat : ${s.candidate || '—'} ; distance : ${s.distanceMeters ?? '—'} m ; ${s.reasons.join(', ')}`);
  fs.writeFileSync(path.join(__dirname, `station-names-to-confirm-${department}.md`), `# Noms à confirmer — département ${department}\n\n${result.accepted.length} correspondances acceptées, ${result.skipped.length} stations ignorées. Les stations sans nom restent « Station-service ».\n\n${lines.join('\n\n')}\n`);
  if (process.argv.includes('--merge')) {
    const file = path.join(__dirname, 'station-overrides.json'), existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    const merged = mergeOverrides(existing, result.accepted);
    fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
    console.log(`Added ${Object.keys(merged).length - Object.keys(existing).length} names; existing overrides preserved.`);
  }
  console.log(JSON.stringify({ department, stations: stations.length, accepted: result.accepted.length, skipped: result.skipped.length }));
}
module.exports = { parseCsv, distance, review, mergeOverrides, main };
