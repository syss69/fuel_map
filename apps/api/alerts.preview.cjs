// Local-only authenticated preview. All writes roll back; no email/push providers run.
require('reflect-metadata');require('dotenv').config();
const {randomUUID}=require('node:crypto');const {Pool}=require('pg');const http=require('node:http');const path=require('node:path');
const {DigestService,digestSettingsSchema}=require('./dist/digest/digest.service');
const {AlertsService,ruleSchema}=require('./dist/alerts/alerts.service');const {StationsService}=require('./dist/stations/stations.service');const {QueueService}=require('./dist/stations/queue.service');const {CommunityService}=require('./dist/stations/community.service');
(async()=>{
 const pool=new Pool({connectionString:process.env.DATABASE_URL}),c=await pool.connect();let vite,api,closing=false;
 async function close(){if(closing)return;closing=true;await vite?.close();api?.close();await c.query('ROLLBACK');c.release();await pool.end();process.exit();}
 process.on('SIGINT',close);process.stdin.resume();process.stdin.on('data',close);
 await c.query('BEGIN');
 const proxy={query:(sql,args)=>c.query(sql==='BEGIN'?'SAVEPOINT preview':sql==='COMMIT'?'RELEASE SAVEPOINT preview':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT preview':sql,args),release(){}};const db={pool:{query:proxy.query,connect:async()=>proxy}};
 const digest=new DigestService(db,{send:async()=>{throw new Error('No emails in preview');}});
 const service=new AlertsService(db);const stations=new StationsService(db,new QueueService(db),new CommunityService(db));
 const sub=(await c.query('INSERT INTO subscribers(email,email_verified_at) VALUES($1,now()) RETURNING id',[`preview-${randomUUID()}@example.test`])).rows[0].id;
 const station=randomUUID();await c.query("INSERT INTO stations(id,official_id,display_name,department_code,location,last_seen_at) VALUES($1,$2,'Station de démonstration','64',ST_SetSRID(ST_MakePoint(-0.3708,43.2951),4326)::geography,now())",[station,station]);
 await c.query("INSERT INTO station_fuels(station_id,fuel_type_id,price_milli_eur,availability) SELECT $1,id,1899,'AVAILABLE' FROM fuel_types",[station]);
 await service.save(sub,{stationId:station,fuelCode:'SP98',eventType:'PRICE_DROP',priceThresholdMilliEur:2000,frequency:'RECURRING',status:'ACTIVE'});
 await c.query("INSERT INTO digest_subscriptions(email,fuel_type_id,center,radius_meters,unsubscribe_token_hash,unsubscribe_nonce,weekdays,status,verified_at,favorite_station_id) SELECT email,(SELECT id FROM fuel_types WHERE code='GAZOLE'),ST_SetSRID(ST_MakePoint(-0.3708,43.2951),4326)::geography,10000,$2,$3,ARRAY[1,3,5],'ACTIVE',now(),$4 FROM subscribers WHERE id=$1",[sub,randomUUID(),randomUUID(),station]);
 let sessionActive=true,failSave=false;
 let chain=Promise.resolve();api=http.createServer((req,res)=>{chain=chain.then(async()=>{
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5174');res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,PUT,POST,OPTIONS');res.setHeader('Content-Type','application/json');
  if(req.method==='OPTIONS'){res.end();return;}try{let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):null;const url=new URL(req.url,'http://localhost');let result;
   if(url.pathname==='/__preview/session'){sessionActive=url.searchParams.get('active')!=='false';res.end('{}');return;}
   if(url.pathname==='/__preview/failure'){failSave=url.searchParams.get('active')==='true';res.end('{}');return;}
   if(url.pathname.startsWith('/api/v1/alerts/')&&!sessionActive){res.statusCode=401;res.end(JSON.stringify({message:'Votre session a expiré.'}));return;}
   if(url.pathname==='/api/v1/alerts/digest'&&req.method==='GET')result=await digest.current(sub);
   else if(url.pathname==='/api/v1/alerts/digest'&&req.method==='PUT'){if(failSave)throw new Error('Échec simulé. Réessayez.');result=await digest.updateSettings(sub,digestSettingsSchema.parse(body));}
   else if(url.pathname==='/api/v1/alerts/digest/status'&&req.method==='PUT')result=await digest.updateStatus(sub,body.status);
   else if(url.pathname==='/api/v1/alerts/me')result={email:'preview@example.test',rules:await service.list(sub),devices:[]};
   else if(url.pathname==='/api/v1/alerts/rules'&&req.method==='PUT')result=await service.save(sub,ruleSchema.parse(body));
   else if(url.pathname==='/api/v1/alerts/disable-all')result=await service.disableAll(sub);
   else if(url.pathname==='/api/v1/stations'){const list=await stations.list();result={...list,stations:list.stations.filter(s=>s.id===station)};}
   else if(url.pathname===`/api/v1/stations/${station}`)result=await stations.detail(station);
   else{res.statusCode=404;result={message:'Preview route unavailable'};}res.end(JSON.stringify(result));
  }catch(e){res.statusCode=400;res.end(JSON.stringify({message:e.message}));}
 });});await new Promise(resolve=>api.listen(3102,'127.0.0.1',resolve));
 process.env.VITE_API_BASE_URL='http://127.0.0.1:3102/api/v1';const {createServer}=await import('vite');const {default:react}=await import('@vitejs/plugin-react');vite=await createServer({root:path.resolve(__dirname,'../web'),configFile:false,plugins:[react()],server:{host:'127.0.0.1',port:5174,strictPort:true}});await vite.listen();console.log('Preview: http://127.0.0.1:5174/mes-alertes ; Enter rolls back and stops.');
})().catch(e=>{console.error(e);process.exit(1);});
