// npm run build && node apps/api/community.integration.cjs
// Runs real SQL; a surrounding transaction rolls back every fixture and mutation.
require('reflect-metadata');
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { CommunityService, fuelReportsSchema, confirmationSchema } = require('./dist/stations/community.service');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const station = randomUUID(), me = randomUUID(), other = randomUUID(), third = randomUUID();
    await client.query(`INSERT INTO stations(id,official_id,department_code,location,last_seen_at)
      VALUES($1,$2,$3,ST_SetSRID(ST_MakePoint(0,43),4326)::geography,now())`,
      [station, `community-test-${station}`, process.env.FUEL_DATASET_DEPARTMENT || '64']);
    await client.query(`INSERT INTO station_fuels(station_id,fuel_type_id,price_milli_eur,availability)
      SELECT $1,id,1899,'AVAILABLE' FROM fuel_types`, [station]);
    await client.query(`INSERT INTO queue_reports(station_id,reporter_id,queue_status) VALUES($1,$2,'LT_5')`, [station, me]);
    const officialBefore = (await client.query('SELECT * FROM station_fuels WHERE station_id=$1 ORDER BY fuel_type_id', [station])).rows;
    const queueBefore = (await client.query('SELECT * FROM queue_reports WHERE station_id=$1', [station])).rows;
    const proxy = {
      query: (sql, args) => client.query(sql === 'BEGIN' ? 'SAVEPOINT community_write' : sql === 'COMMIT'
        ? 'RELEASE SAVEPOINT community_write' : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT community_write' : sql, args),
      release() {},
    };
    const service = new CommunityService({ pool: { connect: async () => proxy, query: client.query.bind(client) } });
    const read = () => service.aggregate(station, me);
    const report = (reporter, fuels) => service.report(station, reporter, fuels);
    const records = () => client.query('SELECT * FROM fuel_change_reports WHERE station_id=$1 AND reporter_id=$2 ORDER BY fuel_type_id', [station, me]);
    assert.deepEqual(await read(), { confirmationsCount: 0, myConfirmationActive: false, hasDiscrepancies: false, fuelDiscrepancies: [] });
    for (const body of [
      {reporterId:'bad',fuels:[{fuelCode:'SP98',priceMilliEur:1900}]},
      {reporterId:me,fuels:[]}, {reporterId:me,fuels:[{fuelCode:'SP98'}]},
      {reporterId:me,fuels:[{fuelCode:'BAD',availability:'AVAILABLE'}]},
      {reporterId:me,fuels:[{fuelCode:'SP98',availability:'UNKNOWN'}]},
      ...[0,-1,1.1,2147483648,null].map(priceMilliEur => ({reporterId:me,fuels:[{fuelCode:'SP98',priceMilliEur}]})),
      {reporterId:me,fuels:[{fuelCode:'SP98',priceMilliEur:1800},{fuelCode:'SP98',priceMilliEur:1801}]},
    ]) assert.equal(fuelReportsSchema.safeParse(body).success, false);
    assert.equal(confirmationSchema.safeParse({reporterId:'bad'}).success,false);
    assert.equal(fuelReportsSchema.safeParse({reporterId:me,fuels:[{fuelCode:'SP98',priceMilliEur:2147483647}]}).success,true);
    await service.confirm(station, me);
    const firstConfirmation = (await client.query('SELECT * FROM station_data_confirmations WHERE station_id=$1', [station])).rows[0];
    await service.confirm(station, me);
    assert.equal((await read()).confirmationsCount, 1);
    const secondConfirmation = (await client.query('SELECT * FROM station_data_confirmations WHERE station_id=$1', [station])).rows[0];
    assert.equal(firstConfirmation.id, secondConfirmation.id);
    assert.equal(+firstConfirmation.created_at, +secondConfirmation.created_at);
    assert.equal(+secondConfirmation.expires_at - +secondConfirmation.updated_at, 3*3600000);
    await assert.rejects(() => report(me,[{fuelCode:'SP98',priceMilliEur:1899,availability:'AVAILABLE'}]), /Aucune différence/);
    assert.equal((await read()).myConfirmationActive, true);
    await report(me,[{fuelCode:'SP98',priceMilliEur:1769,availability:'UNAVAILABLE'},{fuelCode:'E10',priceMilliEur:1700}]);
    assert.equal((await read()).myConfirmationActive, false);
    const original = (await records()).rows.find(r=>r.reported_price_milli_eur===1769);
    await report(me,[{fuelCode:'SP98',availability:'UNAVAILABLE'}]);
    const replaced = (await records()).rows.find(r=>r.id===original.id);
    assert.equal(replaced.reported_price_milli_eur, null);
    assert.equal(+replaced.created_at, +original.created_at);
    assert.equal(+replaced.expires_at - +replaced.updated_at,3*3600000);
    assert.equal((await records()).rows.length,2);
    await report(other,[{fuelCode:'SP98',priceMilliEur:1769,availability:'UNAVAILABLE'}]);
    await report(third,[{fuelCode:'SP98',priceMilliEur:1779}]);
    await client.query(`UPDATE fuel_change_reports SET updated_at=now()-interval '1 minute' WHERE station_id=$1 AND reporter_id=$2`,[station,other]);
    let discrepancy = (await read()).fuelDiscrepancies.find(f=>f.fuelCode==='SP98');
    assert.equal(discrepancy.availability.reportsCount,2);
    assert.equal(discrepancy.price.valueMilliEur,1779); // newest breaks the price tie
    await report(me,[{fuelCode:'SP98',priceMilliEur:1769,availability:'UNAVAILABLE'}]);
    discrepancy = (await read()).fuelDiscrepancies.find(f=>f.fuelCode==='SP98');
    assert.equal(discrepancy.price.valueMilliEur,1769);
    assert.equal(discrepancy.price.reportsCount,2);
    assert.equal(JSON.stringify(await read()).includes(other),false);
    assert.deepEqual((await client.query('SELECT * FROM station_fuels WHERE station_id=$1 ORDER BY fuel_type_id',[station])).rows,officialBefore);
    assert.deepEqual((await client.query('SELECT * FROM queue_reports WHERE station_id=$1',[station])).rows,queueBefore);
    // Simulate a later government update only on this rolled-back test station.
    await client.query(`UPDATE station_fuels SET price_milli_eur=1769,availability='TEMPORARILY_UNAVAILABLE'
      WHERE station_id=$1 AND fuel_type_id=(SELECT id FROM fuel_types WHERE code='SP98')`,[station]);
    discrepancy = (await read()).fuelDiscrepancies.find(f=>f.fuelCode==='SP98');
    assert.equal(discrepancy.availability,null);
    assert.equal(discrepancy.price.valueMilliEur,1779);
    await assert.rejects(()=>report(me,[{fuelCode:'SP98',availability:'UNAVAILABLE'}]),/Aucune différence/);
    await client.query(`UPDATE station_fuels SET availability='PERMANENTLY_UNAVAILABLE' WHERE station_id=$1 AND fuel_type_id=(SELECT id FROM fuel_types WHERE code='SP98')`,[station]);
    await assert.rejects(()=>report(me,[{fuelCode:'SP98',availability:'UNAVAILABLE'}]),/Aucune différence/);
    await client.query(`UPDATE station_fuels SET availability='UNKNOWN' WHERE station_id=$1 AND fuel_type_id=(SELECT id FROM fuel_types WHERE code='SP98')`,[station]);
    await report(me,[{fuelCode:'SP98',availability:'AVAILABLE',priceMilliEur:1769}]);
    assert.equal((await records()).rows.find(r=>r.id===original.id).reported_price_milli_eur,null);
    await report(other,[{fuelCode:'SP98',availability:'UNAVAILABLE'}]);
    assert.equal((await read()).fuelDiscrepancies.find(f=>f.fuelCode==='SP98').availability.value,'AVAILABLE'); // exact tie: enum order
    await service.confirm(station,me);
    assert.equal((await read()).myConfirmationActive,true);
    assert.equal((await client.query('SELECT count(*)::int n FROM fuel_change_reports WHERE station_id=$1 AND reporter_id=$2 AND expires_at>now()',[station,me])).rows[0].n,0);
    await client.query('UPDATE fuel_change_reports SET expires_at=now() WHERE station_id=$1',[station]);
    await client.query('UPDATE station_data_confirmations SET expires_at=now() WHERE station_id=$1',[station]);
    assert.deepEqual(await read(), { confirmationsCount:0,myConfirmationActive:false,hasDiscrepancies:false,fuelDiscrepancies:[] });
    await report(me,[{fuelCode:'SP98',priceMilliEur:1800}]);
    assert.equal((await records()).rows.find(r=>r.id===original.id).id,original.id);
    await assert.rejects(()=>service.confirm(randomUUID(),me),/Station introuvable/);
    // PostgreSQL constraints also enforce a value and positive price.
    for (const values of ['NULL,NULL',"0,NULL"]) {
      await client.query('SAVEPOINT invalid_row');
      await assert.rejects(()=>client.query(`INSERT INTO fuel_change_reports(station_id,fuel_type_id,reporter_id,reported_price_milli_eur,reported_availability)
        VALUES($1,(SELECT id FROM fuel_types WHERE code='SP95'),$2,${values})`,[station,randomUUID()]));
      await client.query('ROLLBACK TO SAVEPOINT invalid_row');
    }
    console.log('Community PostgreSQL checks passed; all test writes rolled back.');
  } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
