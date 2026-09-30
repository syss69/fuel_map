require('reflect-metadata');require('dotenv').config();
process.env.VAPID_PUBLIC_KEY='test';process.env.VAPID_PRIVATE_KEY='test';process.env.VAPID_SUBJECT='mailto:test@example.test';process.env.RESEND_API_KEY='test';
const assert=require('node:assert/strict');const {randomUUID,randomBytes}=require('node:crypto');const {Pool}=require('pg');
const {AlertsService,ruleSchema,pushSchema,allowedPushEndpoint}=require('./dist/alerts/alerts.service');
const {SubscriberService,hashToken,SESSION_COOKIE}=require('./dist/alerts/subscriber.service');
const {AlertProcessor}=require('./dist/alerts/alert-processor.service');
const {AlertsController}=require('./dist/alerts/alerts.module');
(async()=>{
 const pool=new Pool({connectionString:process.env.DATABASE_URL}),c=await pool.connect();
 const query=(sql,args)=>c.query(sql==='BEGIN'?'SAVEPOINT write_op':sql==='COMMIT'?'RELEASE SAVEPOINT write_op':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT write_op':sql,args);
 const proxy={query,release(){}};const db={pool:{query,connect:async()=>proxy}};const emails=[],pushes=[];let fail=0;
 const identity=new SubscriberService(db,{send:async(message)=>{emails.push(message);return randomUUID();}});
 const alerts=new AlertsService(db);const processor=new AlertProcessor(db,{send:async(s,p)=>{pushes.push({endpoint:s.endpoint,p});if(fail)throw {statusCode:fail};}});
 try{
  await c.query('BEGIN');await c.query('UPDATE fuel_events SET processed_at=now() WHERE processed_at IS NULL');await c.query("UPDATE push_deliveries SET status='FAILED' WHERE status='PENDING'");
  const email=`push-${randomUUID()}@example.test`;await identity.request(email,randomUUID());assert.equal(emails.length,1);
  const token=new URL(emails[0].text.match(/alertes : (\S+)/)[1]).hash.slice(1);const session=await identity.verify(token);
  await assert.rejects(()=>identity.verify(token));const cookie=`${SESSION_COOKIE}=${session}`;const sub=await identity.current(cookie);
  await assert.rejects(()=>identity.current('trajetico_session=bad'));
  const stored=(await c.query('SELECT token_hash FROM subscriber_sessions WHERE subscriber_id=$1',[sub.id])).rows[0].token_hash;assert.equal(stored,hashToken(session));assert.notEqual(stored,session);
  const other=(await c.query('INSERT INTO subscribers(email,email_verified_at) VALUES($1,now()) RETURNING id',[`other-${randomUUID()}@example.test`])).rows[0].id;
  const station=randomUUID();await c.query(`INSERT INTO stations(id,official_id,department_code,location,last_seen_at) VALUES($1,$2,'64',ST_SetSRID(ST_MakePoint(-0.37,43.29),4326)::geography,now())`,[station,`push-${station}`]);
  const fuel=(await c.query("SELECT id FROM fuel_types WHERE code='SP98'")).rows[0].id;
  await c.query("INSERT INTO station_fuels(station_id,fuel_type_id,price_milli_eur,availability) VALUES($1,$2,2300,'UNKNOWN')",[station,fuel]);
  const count=async(table)=>(await c.query(`SELECT count(*)::int n FROM ${table} WHERE ${table==='fuel_events'?'station_id':table==='notification_events'?'subscriber_id':'id'}=$1`,[table==='fuel_events'?station:sub.id])).rows[0].n;
  assert.equal(await count('fuel_events'),0);
  const devices=[];for(let i=0;i<2;i++){const body={endpoint:`https://fcm.googleapis.com/fcm/send/${randomUUID()}`,keys:{p256dh:randomBytes(65).toString('base64url'),auth:randomBytes(16).toString('base64url')},deviceLabel:`Test ${i}`};assert.ok(pushSchema.safeParse(body).success);const d=await alerts.register(sub.id,body);assert.equal((await alerts.register(sub.id,body)).id,d.id);await assert.rejects(()=>alerts.register(other,body));devices.push(d.id);}
  assert.equal(allowedPushEndpoint('https://127.0.0.1/test'),false);assert.equal(allowedPushEndpoint('https://fcm.googleapis.com.evil.test/'),false);
  await assert.rejects(()=>alerts.revoke(other,devices[0]));assert.equal((await alerts.devices(other)).length,0);
  const rule={stationId:station,fuelCode:'SP98',eventType:'PRICE_DROP',priceThresholdMilliEur:2000,frequency:'RECURRING',status:'ACTIVE'};assert.ok(ruleSchema.safeParse(rule).success);for(const threshold of [undefined,null,0,-1,1.5,2147483648])assert.equal(ruleSchema.safeParse({...rule,priceThresholdMilliEur:threshold}).success,false);
  const priceRule=await alerts.save(sub.id,rule);assert.equal((await alerts.save(sub.id,rule)).id,priceRule.id);
  await alerts.save(sub.id,{...rule,eventType:'FUEL_AVAILABLE',frequency:'ONCE'});
  await processor.processEvents();assert.equal(await count('notification_events'),0);
  const update=async(price,availability='AVAILABLE')=>{await c.query('UPDATE station_fuels SET price_milli_eur=$2,availability=$3 WHERE station_id=$1',[station,price,availability]);await processor.processEvents();};
  await update(2300);assert.equal(await count('notification_events'),0); // UNKNOWN -> AVAILABLE excluded
  await update(2000);assert.equal(await count('notification_events'),0);
  await update(1900);assert.equal(await count('notification_events'),1);
  await update(1800);assert.equal(await count('notification_events'),1);
  await update(1950);await update(1900);assert.equal(await count('notification_events'),1);
  await update(2100);await update(1900);assert.equal(await count('notification_events'),2);
  await update(null);await update(1700);assert.equal(await count('notification_events'),2);
  await update(1700,'TEMPORARILY_UNAVAILABLE');await update(1700);assert.equal(await count('notification_events'),3);
  assert.equal((await alerts.list(sub.id)).find(r=>r.eventType==='FUEL_AVAILABLE').status,'COMPLETED');
  await update(1700,'UNAVAILABLE');await update(1700);assert.equal(await count('notification_events'),3);
  await processor.processEvents();assert.equal(await count('notification_events'),3);
  assert.equal((await c.query('SELECT count(*)::int n FROM push_deliveries WHERE push_subscription_id=ANY($1)',[devices])).rows[0].n,6);
  fail=429;await processor.deliver();assert.equal((await c.query("SELECT count(*)::int n FROM push_deliveries WHERE push_subscription_id=ANY($1) AND status='PENDING' AND attempt_count=1",[devices])).rows[0].n,6);
  fail=0;await c.query('UPDATE push_deliveries SET next_attempt_at=now() WHERE push_subscription_id=ANY($1)',[devices]);await processor.deliver();assert.equal((await c.query("SELECT count(*)::int n FROM push_deliveries WHERE push_subscription_id=ANY($1) AND status='SENT'",[devices])).rows[0].n,6);
  await c.query('SAVEPOINT retry_limit');
  await c.query("UPDATE push_deliveries SET status='PENDING',attempt_count=4,next_attempt_at=now() WHERE push_subscription_id=ANY($1)",[devices]);fail=500;await processor.deliver();
  assert.equal((await c.query("SELECT count(*)::int n FROM push_deliveries WHERE push_subscription_id=ANY($1) AND status='FAILED' AND attempt_count=5",[devices])).rows[0].n,6);
  await c.query('ROLLBACK TO SAVEPOINT retry_limit');
  await c.query('SAVEPOINT gone_404');
  await c.query("UPDATE push_deliveries SET status='PENDING',attempt_count=0,next_attempt_at=now() WHERE push_subscription_id=ANY($1)",[devices]);fail=404;await processor.deliver();assert.ok((await alerts.devices(sub.id)).every(d=>d.revokedAt));
  await c.query('ROLLBACK TO SAVEPOINT gone_404');fail=0;
  await alerts.revoke(sub.id,devices[0]);assert.equal((await alerts.list(sub.id)).find(r=>r.eventType==='PRICE_DROP').status,'ACTIVE');
  await alerts.save(sub.id,{...rule,eventType:'FUEL_AVAILABLE'});await update(1700,'PERMANENTLY_UNAVAILABLE');await update(1700);assert.equal(await count('notification_events'),4);
  fail=410;await processor.deliver();assert.ok((await alerts.devices(sub.id)).every(d=>d.revokedAt));
  await alerts.disableAll(sub.id);assert.ok((await alerts.list(sub.id)).every(r=>r.status==='DISABLED'));
  // A queued event before activation must never trigger a newly enabled rule.
  await c.query('UPDATE station_fuels SET price_milli_eur=1500 WHERE station_id=$1',[station]);await alerts.save(sub.id,{...rule,frequency:'ONCE'});const before=await count('notification_events');await processor.processEvents();assert.equal(await count('notification_events'),before);
  await update(1400);assert.equal(await count('notification_events'),before+1);assert.equal((await alerts.list(sub.id)).find(r=>r.eventType==='PRICE_DROP').status,'COMPLETED');
  const events=await count('fuel_events');await c.query('SAVEPOINT atomic_event');await c.query('UPDATE station_fuels SET price_milli_eur=1000 WHERE station_id=$1',[station]);assert.ok(await count('fuel_events')>events);await c.query('ROLLBACK TO SAVEPOINT atomic_event');assert.equal(await count('fuel_events'),events);
  // Digest shares identity; its disable does not change rules.
  await c.query(`INSERT INTO digest_subscriptions(email,fuel_type_id,center,radius_meters,unsubscribe_token_hash,unsubscribe_nonce,verified_at,status) VALUES($1,$2,ST_SetSRID(ST_MakePoint(0,0),4326)::geography,5000,$3,$4,now(),'ACTIVE')`,[email,fuel,randomUUID(),randomUUID()]);
  assert.equal((await c.query('SELECT subscriber_id FROM digest_subscriptions WHERE email=$1',[email])).rows[0].subscriber_id,sub.id);
  await c.query("UPDATE digest_subscriptions SET status='UNSUBSCRIBED' WHERE email=$1",[email]);assert.equal((await alerts.list(sub.id)).find(r=>r.eventType==='PRICE_DROP').status,'COMPLETED');
  const controller=new AlertsController(identity,alerts);assert.throws(()=>controller.login({email},'test','https://evil.test'));await assert.rejects(()=>controller.me());
  await identity.logout(cookie);await assert.rejects(()=>identity.current(cookie));
  const expired=randomBytes(32).toString('base64url');await c.query("INSERT INTO subscriber_magic_links(token_hash,subscriber_id,expires_at) VALUES($1,$2,now())",[hashToken(expired),sub.id]);await assert.rejects(()=>identity.verify(expired));
  // Exercise actual Nest routing, authentication and cookie flags without background jobs.
  const {Module}=require('@nestjs/common');const {NestFactory}=require('@nestjs/core');
  class TestModule{};Module({controllers:[AlertsController],providers:[{provide:SubscriberService,useValue:identity},{provide:AlertsService,useValue:alerts}]})(TestModule);
  const app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');
  try{
   const url=await app.getUrl();const origin=process.env.FRONTEND_ORIGIN||'http://localhost:5173';
   const fresh=randomBytes(32).toString('base64url');await c.query("INSERT INTO subscriber_magic_links(token_hash,subscriber_id,expires_at) VALUES($1,$2,now()+interval '1 minute')",[hashToken(fresh),sub.id]);
   const response=await fetch(url+'/api/v1/alerts/verify',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:fresh})});
   assert.equal(response.status,200);const setCookie=response.headers.get('set-cookie');assert.ok(setCookie.includes('HttpOnly'));assert.ok(setCookie.includes('SameSite=Lax'));
   const logged=await fetch(url+'/api/v1/alerts/me',{headers:{Cookie:setCookie.split(';')[0]}});assert.equal(logged.status,200);assert.equal((await logged.json()).email,email);
   assert.equal((await fetch(url+'/api/v1/alerts/me')).status,401);
   assert.equal((await fetch(url+'/api/v1/alerts/disable-all',{method:'POST',headers:{Cookie:setCookie.split(';')[0],Origin:'https://evil.test'}})).status,403);
  }finally{await app.close();}
  console.log('Push PostgreSQL checks passed: identity/session, ownership, CSRF, baselines, ONCE, price re-arm, recurring availability, null/unknown exclusion, atomic rollback, idempotency, multiple devices, retry/410, disable, digest isolation. No external messages sent.');
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
