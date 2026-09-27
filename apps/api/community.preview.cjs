// Isolated manual UI test: node apps/api/community.preview.cjs
// Uses one PostgreSQL transaction; Ctrl+C rolls back all fixtures and reports.
// First community submit intentionally returns 503 to test draft preservation.
require('reflect-metadata');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { randomUUID } = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const { CommunityService, fuelReportsSchema, confirmationSchema } = require('./dist/stations/community.service');
const { QueueService } = require('./dist/stations/queue.service');
const { StationsService } = require('./dist/stations/stations.service');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  await client.query('BEGIN');
  let api, vite;
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    try { await vite?.close(); api?.close(); await client.query('ROLLBACK'); }
    finally { client.release(); await pool.end(); console.log('Preview fixtures rolled back.'); process.exit(); }
  }
  process.on('SIGINT', close); process.on('SIGTERM', close);
  process.stdin.resume(); process.stdin.on('data', close);
  try {
    const station = randomUUID();
    await client.query(`INSERT INTO stations(id,official_id,display_name,department_code,location,last_seen_at)
      VALUES($1,$2,'Community test',$3,ST_SetSRID(ST_MakePoint(-0.3708,43.2951),4326)::geography,now())`,
      [station,`community-preview-${station}`,process.env.FUEL_DATASET_DEPARTMENT || '64']);
    await client.query(`INSERT INTO station_fuels(station_id,fuel_type_id,price_milli_eur,availability)
      SELECT $1,id,1899,'AVAILABLE' FROM fuel_types`,[station]);
    const proxy = { query:(sql,args)=>client.query(sql==='BEGIN'?'SAVEPOINT preview_write':sql==='COMMIT'?'RELEASE SAVEPOINT preview_write':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT preview_write':sql,args),release(){} };
    const db = { pool:{connect:async()=>proxy,query:client.query.bind(client)} };
    const community = new CommunityService(db), queues = new QueueService(db);
    const stations = new StationsService(db,queues,community);
    await community.report(station,randomUUID(),[{fuelCode:'SP98',priceMilliEur:1769,availability:'UNAVAILABLE'}]);
    let failNext = true;
    let pending = Promise.resolve();
    api = http.createServer((req,res)=>{
      pending = pending.then(async()=>{
        res.setHeader('Access-Control-Allow-Origin','http://localhost:5174');
        res.setHeader('Access-Control-Allow-Headers','Content-Type');
        res.setHeader('Access-Control-Allow-Methods','GET,PUT,OPTIONS');
        res.setHeader('Content-Type','application/json');
        if(req.method==='OPTIONS'){res.end();return;}
        try {
          const url=new URL(req.url,'http://localhost');
          let result;
          if(req.method==='GET' && url.pathname==='/api/v1/stations') {
            const all=await stations.list(); result={...all,stations:all.stations.filter(s=>s.id===station)};
          } else if(req.method==='GET' && url.pathname===`/api/v1/stations/${station}`) {
            result=await stations.detail(station,url.searchParams.get('reporterId') || undefined);
          } else if(req.method==='PUT' && [`/api/v1/stations/${station}/confirmation`,`/api/v1/stations/${station}/fuel-reports`].includes(url.pathname)) {
            let raw=''; for await(const chunk of req) raw+=chunk;
            if(failNext){failNext=false;res.statusCode=503;res.end(JSON.stringify({message:'Erreur de test : réessayez, vos modifications sont conservées.'}));return;}
            const confirmation=url.pathname.endsWith('/confirmation');
            const body=(confirmation?confirmationSchema:fuelReportsSchema).parse(JSON.parse(raw));
            result=confirmation?await community.confirm(station,body.reporterId):await community.report(station,body.reporterId,body.fuels);
          } else {res.statusCode=404;res.end('{}');return;}
          res.end(JSON.stringify(result));
        } catch(error){res.statusCode=error.getStatus?.() || 400;res.end(JSON.stringify({message:error.message}));}
      });
    });
    await new Promise(resolve=>api.listen(3101,'127.0.0.1',resolve));
    process.env.VITE_API_BASE_URL='http://localhost:3101/api/v1';
    const {createServer}=await import('vite');
    const {default:react}=await import('@vitejs/plugin-react');
    vite=await createServer({root:path.resolve(__dirname,'../web'),configFile:false,plugins:[react()],server:{host:'127.0.0.1',port:5174,strictPort:true}});
    await vite.listen();
    console.log('Isolated community preview: http://localhost:5174 (press Enter to roll back and stop)');
  } catch(error){console.error(error);await close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
