// Real PostgreSQL and Nest HTTP; every fixture rolls back. No real senders/schedulers.
require('reflect-metadata');
require('dotenv').config({path:require('node:path').resolve(__dirname,'../../.env')});
process.env.RESEND_API_KEY='test-only';process.env.DIGEST_ENABLED='true';
process.env.DIGEST_TOKEN_SECRET='test-only-secret-'.repeat(4);
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('pg');
const {Module}=require('@nestjs/common');const {NestFactory}=require('@nestjs/core');
const {DigestService}=require('./dist/digest/digest.service');
const {DigestManagementController}=require('./dist/alerts/alerts.module');
const {SubscriberService,SESSION_COOKIE,hashToken}=require('./dist/alerts/subscriber.service');
(async()=>{
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 const c=await pool.connect(),blocker=await pool.connect();let app;
 const proxy={query:(sql,args)=>c.query(sql==='BEGIN'?'SAVEPOINT write':sql==='COMMIT'?'RELEASE SAVEPOINT write':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT write':sql,args),release(){}};
 const db={pool:{query:proxy.query,connect:async()=>proxy}};
 const sender={send:async()=>{throw new Error('Unexpected email in management test');}};
 const digest=new DigestService(db,sender),identity=new SubscriberService(db,sender);
 try {
  await c.query('BEGIN');
  const email=`manage-${randomUUID()}@example.test`;
  const owner=(await c.query('INSERT INTO subscribers(email,email_verified_at) VALUES($1,now()) RETURNING id',[email])).rows[0].id;
  const other=(await c.query('INSERT INTO subscribers(email,email_verified_at) VALUES($1,now()) RETURNING id',[`other-${email}`])).rows[0].id;
  const sub=(await c.query(`INSERT INTO digest_subscriptions(email,fuel_type_id,center,radius_meters,unsubscribe_token_hash,unsubscribe_nonce,last_confirmation_at)
    SELECT $1,id,ST_SetSRID(ST_MakePoint(-0.37,43.3),4326)::geography,5000,$2,$3,now() FROM fuel_types WHERE code='GAZOLE' RETURNING *`,[email,randomUUID(),randomUUID()])).rows[0];
  const settings={fuelCode:'SP98',lat:43.3,lng:-0.4,radiusMeters:10000,favoriteStationId:null,weekdays:[1,3,5]};
  const pid=(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  // A separate sender connection holding the subscription lock blocks each mutation.
  // Savepoint rollback releases transaction locks between cases, without committed fixtures.
  for(const operation of [()=>digest.updateSettings(owner,settings),()=>digest.updateStatus(owner,'ACTIVE'),
    ()=>digest.subscribe({...settings,email},randomUUID()),()=>digest.sendMorning(proxy,sub.id)]) {
   await c.query('SAVEPOINT concurrency');
   await blocker.query('SELECT pg_advisory_lock(hashtextextended($1,2))',[sub.id]);
   let completed=false;const pending=operation().finally(()=>{completed=true;});
   let waiting=false;
   try {
    for(let i=0;i<100;i++){
     const result=await blocker.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock' AND lower(wait_event)='advisory'",[pid]);
     if(result.rowCount){waiting=true;break;}
     await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.ok(waiting,'Operation must wait for the delivery subscription lock');assert.equal(completed,false);
   } finally {await blocker.query('SELECT pg_advisory_unlock(hashtextextended($1,2))',[sub.id]);await pending;}
   await c.query('ROLLBACK TO SAVEPOINT concurrency');
  }
  const cookies=[];
  for(const subscriber of [owner,other]){
   const token=randomBytes(32).toString('base64url');
   await c.query("INSERT INTO subscriber_sessions(token_hash,subscriber_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hashToken(token),subscriber]);
   cookies.push(`${SESSION_COOKIE}=${token}`);
  }
  class TestModule{}
  Module({controllers:[DigestManagementController],providers:[{provide:SubscriberService,useValue:identity},{provide:DigestService,useValue:digest}]})(TestModule);
  app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');
  const base=await app.getUrl(),origin=process.env.FRONTEND_ORIGIN||'http://localhost:5173';
  const request=(path='',method='GET',body, cookie=cookies[0],requestOrigin=origin)=>fetch(base+'/api/v1/alerts/digest'+path,{method,headers:{Cookie:cookie,Origin:requestOrigin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal((await request('','GET',undefined,'')).status,401);
  assert.equal(await (await request('','GET',undefined,cookies[1])).json(),null);
  assert.equal((await request('','PUT',settings,cookies[1])).status,404);
  assert.equal((await request('/status','PUT',{status:'ACTIVE'},cookies[1])).status,404);
  const initial=await (await request()).json();assert.equal(initial.status,'PENDING');assert.equal(initial.favoriteStation,null);
  assert.equal((await request('','PUT',settings,cookies[0],'https://evil.example')).status,403);
  assert.equal((await request('','PUT',settings,cookies[0],'')).status,403);
  for(const invalid of [{...settings,email},{...settings,subscriberId:other},{...settings,favoriteStationId:'bad'},{...settings,favoriteStationId:randomUUID()},{...settings,weekdays:[]},{...settings,weekdays:[1,2,3,4]},{...settings,lat:91},{...settings,radiusMeters:20000}])assert.equal((await request('','PUT',invalid)).status,400);
  assert.deepEqual(await (await request()).json(),initial);
  assert.equal((await request('/status','PUT',{status:'PENDING'})).status,400);
  const updated=await request('','PUT',settings);assert.equal(updated.status,200);assert.equal((await updated.json()).fuelCode,'SP98');
  const rulesBefore=(await c.query('SELECT * FROM alert_rules ORDER BY id')).rows;
  for(const status of ['ACTIVE','UNSUBSCRIBED','ACTIVE'])assert.equal((await (await request('/status','PUT',{status})).json()).status,status);
  assert.deepEqual((await c.query('SELECT * FROM alert_rules ORDER BY id')).rows,rulesBefore);
  assert.equal((await c.query('SELECT id,unsubscribe_token_hash FROM digest_subscriptions WHERE subscriber_id=$1',[owner])).rows[0].id,sub.id);
  assert.equal((await c.query('SELECT unsubscribe_token_hash FROM digest_subscriptions WHERE subscriber_id=$1',[owner])).rows[0].unsubscribe_token_hash,sub.unsubscribe_token_hash);
  await c.query('UPDATE subscriber_sessions SET expires_at=now() WHERE subscriber_id=$1',[owner]);
  assert.equal((await request('','PUT',settings)).status,401);
  console.log('Digest management checks passed: HTTP, sessions, ownership, CSRF, validation, activation, preservation, push isolation and concurrent delivery/resubscription locks. All fixtures rolled back.');
 } finally {await app?.close();await c.query('ROLLBACK');c.release();blocker.release();await pool.end();}
})().catch(error=>{console.error(error);process.exitCode=1;});
