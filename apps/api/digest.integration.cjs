// Build first. PostgreSQL fixtures are rolled back; the email provider is a recording fake.
require('reflect-metadata');
require('dotenv').config({path:require('node:path').resolve(__dirname,'../../.env')});
process.env.RESEND_API_KEY='test-not-a-real-key';
process.env.DIGEST_TOKEN_SECRET='test-only-secret-'.repeat(4);
process.env.PUBLIC_APP_URL='https://trajetico.example';
process.env.EMAIL_FROM='Trajetico <bonjour@trajetico.space>';
process.env.DIGEST_ENABLED='true';
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {DigestService,subscriptionSchema,digestSettingsSchema,tokenHash}=require('./dist/digest/digest.service');
const {EmailService,EmailFailure}=require('./dist/digest/email.service');
const {digestEmail}=require('./dist/digest/email.templates');

(async()=>{
 const pool=new Pool({connectionString:process.env.DATABASE_URL}), client=await pool.connect();
 let clock=new Date(); clock.setUTCHours(12,0,0,0); // after 08:00 Paris in winter and summer
 const originalNow=Date.now; Date.now=()=>+clock;
 const calls=[], accepted=new Map(); let failAfterAccept=false;
 const fake={send:async(message,key)=>{
   calls.push({message,key});
   if(accepted.has(key)){assert.deepEqual(message,accepted.get(key).message);return accepted.get(key).id;}
   const id=randomUUID();accepted.set(key,{message,id});
   if(failAfterAccept){failAfterAccept=false;throw new EmailFailure(true,'simulated timeout after acceptance');}
   return id;
 }};
 const execute=(sql,args)=>client.query(sql.replace(/now\(\)/g,`TIMESTAMPTZ '${clock.toISOString()}'`),args);
 const proxy={query:(sql,args)=>execute(sql==='BEGIN'?'SAVEPOINT digest_write':sql==='COMMIT'?'RELEASE SAVEPOINT digest_write':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT digest_write':sql,args),release(){}};
 const service=new DigestService({pool:{connect:async()=>proxy,query:proxy.query}},fake);
 try {
  await client.query('BEGIN');
  // Test-only hide existing subscriptions within this transaction to isolate scheduler selection.
  await execute("UPDATE digest_subscriptions SET status='UNSUBSCRIBED'");
  const stationIds=[];
  for(const [offset,price,availability,fresh] of [[0.01,1700,'AVAILABLE',true],[0.02,1700,'AVAILABLE',true],[0.03,1800,'AVAILABLE',true],[0.04,1900,'AVAILABLE',true],[0.05,1000,'UNAVAILABLE',true],[0.06,900,'AVAILABLE',false],[0.4,null,'UNAVAILABLE',false]]){
   const id=randomUUID();stationIds.push(id);
   await execute(`INSERT INTO stations(id,official_id,display_name,department_code,location,last_seen_at)
     VALUES($1,$2,$3,'64',ST_SetSRID(ST_MakePoint($4,0),4326)::geography,now()-make_interval(hours=>$5))`,[id,`digest-test-${id}`,offset===0.01?'<script>test</script>':`Test ${offset}`,offset,fresh?0:48]);
   await execute(`INSERT INTO station_fuels(station_id,fuel_type_id,price_milli_eur,availability) SELECT $1,id,$2,$3 FROM fuel_types WHERE code='GAZOLE'`,[id,price,availability]);
  }
  const email=`digest-${randomUUID()}@example.test`,ip=randomUUID();
  const today=clock.getUTCDay() || 7;
  const body={email,fuelCode:'GAZOLE',lat:0,lng:0,radiusMeters:10000,favoriteStationId:stationIds[6],weekdays:[today]};
  for(const weekdays of [[],[1,2,3,4],[1,1],[0],[8],[1.5],undefined])assert.equal(subscriptionSchema.safeParse({...body,weekdays}).success,false);
  for(const invalid of [{...body,radiusMeters:1},{...body,lat:91},{...body,lng:181},{...body,email:'bad'},{...body,fuelCode:'BAD'}])assert.equal(subscriptionSchema.safeParse(invalid).success,false);
  const neutral=await service.subscribe(body,ip);
  await assert.rejects(()=>service.subscribe({...body,favoriteStationId:randomUUID()},randomUUID()),/inconnue/);
  assert.equal(calls.length,1);
  const firstToken=new URL(calls[0].message.text.match(/Confirmer mon abonnement : (\S+)/)[1]).hash.slice(1);
  let sub=(await execute('SELECT * FROM digest_subscriptions WHERE email=$1',[email])).rows[0];
  assert.equal(sub.status,'PENDING');assert.equal(sub.verification_token_hash,tokenHash(firstToken));
  assert.equal(+sub.verification_expires_at-+clock,24*3600000);
  assert.equal(JSON.stringify(sub).includes(firstToken),false);
  // Management acts on the session owner, without exposing credentials or sending email.
  const owner=sub.subscriber_id,other=randomUUID();
  const settings={fuelCode:'SP98',lat:43.3,lng:-0.37,radiusMeters:15000,favoriteStationId:null,weekdays:[1,3,5]};
  assert.equal(await service.current(other),null);
  await assert.rejects(()=>service.updateSettings(other,settings),e=>e.getStatus()===404);
  await assert.rejects(()=>service.updateStatus(other,'ACTIVE'),e=>e.getStatus()===404);
  for(const invalid of [{...settings,email},{...settings,subscriberId:owner},{...settings,favoriteStationId:undefined},{...settings,weekdays:[]},{...settings,weekdays:[1,1]},{...settings,weekdays:[1,2,3,4]},{...settings,radiusMeters:1},{...settings,lat:91},{...settings,lng:-181},{...settings,fuelCode:'BAD'}])assert.equal(digestSettingsSchema.safeParse(invalid).success,false);
  const publicState=await service.current(owner);
  assert.equal(publicState.favoriteStation.id,stationIds[6]);assert.equal(publicState.favoriteStation.lng,0.4);
  assert.ok(!JSON.stringify(publicState).includes('token'));assert.equal(publicState.subscriber_id,undefined);
  await execute('SAVEPOINT management');
  const changed=await service.updateSettings(owner,settings);
  assert.equal(changed.status,'PENDING');assert.equal(changed.fuelCode,'SP98');assert.equal(changed.lat,43.3);assert.equal(changed.lng,-0.37);assert.deepEqual(changed.weekdays,[1,3,5]);assert.equal(changed.favoriteStation,null);
  const activated=await service.updateStatus(owner,'ACTIVE');assert.equal(activated.status,'ACTIVE');
  const activeRow=(await execute('SELECT * FROM digest_subscriptions WHERE id=$1',[sub.id])).rows[0];
  assert.ok(activeRow.verified_at);assert.equal(activeRow.verification_token_hash,null);assert.equal(activeRow.verification_expires_at,null);
  assert.equal(activeRow.unsubscribe_nonce,sub.unsubscribe_nonce);assert.equal(activeRow.unsubscribe_token_hash,sub.unsubscribe_token_hash);
  assert.equal(+activeRow.created_at,+sub.created_at);assert.equal(activeRow.last_sent_at,sub.last_sent_at);
  await service.updateStatus(owner,'UNSUBSCRIBED');assert.equal((await service.updateSettings(owner,settings)).status,'UNSUBSCRIBED');
  await assert.rejects(()=>service.updateSettings(owner,{...settings,favoriteStationId:randomUUID()}),e=>e.getStatus()===400);
  assert.deepEqual(await service.current(owner),{...changed,status:'UNSUBSCRIBED'});
  assert.equal(calls.length,1);
  await execute('ROLLBACK TO SAVEPOINT management');
  await service.runMorning();assert.equal(calls.length,1);
  assert.deepEqual(await service.subscribe(body,ip),neutral);assert.equal(calls.length,1);
  clock=new Date(+clock+6*60000);
  await service.subscribe({...body,radiusMeters:5000},ip);assert.equal(calls.length,2);
  assert.equal((await execute('SELECT count(*)::int n FROM digest_subscriptions WHERE email=$1',[email])).rows[0].n,1);
  await assert.rejects(()=>service.verify(firstToken),/invalide/);
  const token=new URL(calls[1].message.text.match(/Confirmer mon abonnement : (\S+)/)[1]).hash.slice(1);
  await service.verify(token);await assert.rejects(()=>service.verify(token),/invalide/);
  sub=(await execute('SELECT * FROM digest_subscriptions WHERE email=$1',[email])).rows[0];
  assert.equal(sub.status,'ACTIVE');assert.equal(sub.verification_token_hash,null);assert.equal(sub.verification_expires_at,null);
  assert.deepEqual(sub.weekdays,[today]);
  await execute('UPDATE digest_subscriptions SET weekdays=$2 WHERE id=$1',[sub.id,[today===7?1:today+1]]);
  const beforeOffDay=calls.length;await service.runMorning();assert.equal(calls.length,beforeOffDay);
  await execute('UPDATE digest_subscriptions SET weekdays=$2 WHERE id=$1',[sub.id,[today]]);
  await execute('SAVEPOINT weekly_limit');
  for(let i=0;i<3;i++)await execute("INSERT INTO email_deliveries(subscription_id,type,recipient,status,sent_at) VALUES($1,'MORNING_DIGEST',$2,'SENT',now())",[sub.id,email]);
  await service.updateSettings(owner,{...body,favoriteStationId:body.favoriteStationId});await service.updateStatus(owner,'UNSUBSCRIBED');await service.updateStatus(owner,'ACTIVE');
  const beforeWeeklyLimit=calls.length;await service.runMorning();assert.equal(calls.length,beforeWeeklyLimit);
  await execute('ROLLBACK TO SAVEPOINT weekly_limit');
  for(const days of [[],[1,1],[1,2,3,4],[8],[null]]){
    await execute('SAVEPOINT invalid_days');
    await assert.rejects(()=>execute('UPDATE digest_subscriptions SET weekdays=$2 WHERE id=$1',[sub.id,days]),/digest_weekdays/);
    await execute('ROLLBACK TO SAVEPOINT invalid_days');
  }
  assert.deepEqual(await service.subscribe(body,randomUUID()),neutral);assert.equal(calls.length,2);
  const snapshot=await service.snapshot(proxy,sub.id,'2026-09-28');
  assert.deepEqual(snapshot.top.map(s=>s.id),stationIds.slice(0,3));
  assert.equal(snapshot.favorite.id,stationIds[6]);assert.ok(snapshot.favorite.distance>5000);
  await execute('SAVEPOINT empty_zone');
  await execute('UPDATE digest_subscriptions SET center=ST_SetSRID(ST_MakePoint(170,0),4326)::geography WHERE id=$1',[sub.id]);
  const emptySnapshot=await service.snapshot(proxy,sub.id,'2026-09-28');
  assert.equal(emptySnapshot.top.length,0);assert.equal(emptySnapshot.favorite.id,stationIds[6]);
  assert.ok(digestEmail(emptySnapshot,'https://example.test/unsubscribe').text.includes('Aucune station'));
  await execute('ROLLBACK TO SAVEPOINT empty_zone');
  for(const station of [...snapshot.top,snapshot.favorite]){
    const geo=(await execute('SELECT ST_Y(location::geometry) lat,ST_X(location::geometry) lng FROM stations WHERE id=$1',[station.id])).rows[0];
    assert.equal(station.lat,geo.lat);assert.equal(station.lng,geo.lng);
  }
  const rendered=digestEmail(snapshot,'https://example.test/unsubscribe');
  assert.ok(rendered.html.includes('&lt;script&gt;'));assert.ok(!rendered.html.includes('<script>'));
  assert.ok(rendered.text.includes('Prix non disponible'));assert.ok(rendered.text.includes('Carburant actuellement indisponible'));
  assert.equal((rendered.html.match(/Ouvrir dans/g)||[]).length,4);
  assert.equal((rendered.text.match(/Google Maps :/g)||[]).length,4);
  const sample={...snapshot.top[0],lat:43.3,lng:-0.37,name:'A & "B" <script>'};
  const example=digestEmail({...snapshot,top:[sample],favorite:null},'https://example.test/unsubscribe');
  for(const label of ['Google Maps','Apple Plans','Waze']){
    const url=new URL(example.text.split(label+' : ')[1].split('\n')[0]);
    assert.equal(url.protocol,'https:');assert.equal(url.searchParams.get(label==='Google Maps'?'query':'ll'),'43.3,-0.37');
    assert.equal(url.searchParams.has('navigate'),false);
    if(label==='Apple Plans')assert.equal(url.searchParams.get('q'),sample.name);
  }
  for(const coords of [{},{lat:null,lng:0},{lat:91,lng:0},{lat:0,lng:181},{lat:NaN,lng:0}]){
    const {lat,lng,...rest}=sample;
    const result=digestEmail({...snapshot,top:[{...rest,...coords}],favorite:null},'https://example.test/unsubscribe');
    assert.ok(!result.html.includes('Ouvrir dans'));assert.ok(result.text.includes(sample.name));
  }
  assert.ok(!digestEmail({...snapshot,top:[],favorite:null},'https://example.test/unsubscribe').html.includes('Ouvrir dans'));
  failAfterAccept=true;await service.runMorning();
  let delivery=(await execute("SELECT * FROM email_deliveries WHERE subscription_id=$1 AND type='MORNING_DIGEST'",[sub.id])).rows[0];
  assert.equal(delivery.status,'RETRY');const savedPayload=JSON.stringify(delivery.payload);
  await service.updateSettings(owner,{...settings,weekdays:[today]});
  assert.equal(JSON.stringify((await execute('SELECT payload FROM email_deliveries WHERE id=$1',[delivery.id])).rows[0].payload),savedPayload);
  await execute('SAVEPOINT cancel_retry');
  await service.updateStatus(owner,'UNSUBSCRIBED');
  assert.equal((await execute('SELECT status FROM email_deliveries WHERE id=$1',[delivery.id])).rows[0].status,'CANCELLED');
  await service.updateStatus(owner,'ACTIVE');const beforeCancelled=calls.length;await service.runMorning();assert.equal(calls.length,beforeCancelled);
  await execute('ROLLBACK TO SAVEPOINT cancel_retry');
  await execute('UPDATE station_fuels SET price_milli_eur=2000 WHERE station_id=$1',[stationIds[0]]);
  await service.runMorning();
  delivery=(await execute('SELECT * FROM email_deliveries WHERE id=$1',[delivery.id])).rows[0];
  assert.equal(delivery.status,'SENT');assert.ok(delivery.provider_message_id);assert.equal(delivery.attempts,2);
  assert.equal(JSON.stringify(delivery.payload),savedPayload);
  const sentAt=(await execute('SELECT last_sent_at FROM digest_subscriptions WHERE id=$1',[sub.id])).rows[0].last_sent_at;
  await service.updateSettings(owner,{...settings,weekdays:[today]});await service.updateStatus(owner,'UNSUBSCRIBED');await service.updateStatus(owner,'ACTIVE');
  assert.equal(+(await execute('SELECT last_sent_at FROM digest_subscriptions WHERE id=$1',[sub.id])).rows[0].last_sent_at,+sentAt);
  const count=calls.length;await service.runMorning();assert.equal(calls.length,count);
  const digest=calls.at(-1).message;
  const unsubscribeToken=new URL(digest.text.match(/Se désabonner : (\S+)/)[1]).hash.slice(1);
  assert.notEqual(unsubscribeToken,token);assert.equal(tokenHash(unsubscribeToken),sub.unsubscribe_token_hash);
  assert.equal(savedPayload.includes(unsubscribeToken),false);
  await service.unsubscribe(unsubscribeToken);await service.unsubscribe(unsubscribeToken);
  clock=new Date(+clock+86400000);await service.runMorning();assert.equal(calls.length,count);
  const expiredBody={...body,email:`expired-${randomUUID()}@example.test`};
  await service.subscribe(expiredBody,randomUUID());const expired=new URL(calls.at(-1).message.text.match(/Confirmer mon abonnement : (\S+)/)[1]).hash.slice(1);
  clock=new Date(+clock+86400000);await assert.rejects(()=>service.verify(expired),/expiré/);
  // Limits persist in PostgreSQL and apply to all service instances.
  const limitedIp=randomUUID(),before=calls.length;
  for(let i=0;i<11;i++)await service.subscribe({...body,email:`limit-${randomUUID()}@example.test`},limitedIp);
  assert.equal(calls.length-before,10);
  const limitedEmail=`limit-email-${randomUUID()}@example.test`,emailBefore=calls.length;
  for(let i=0;i<4;i++){await service.subscribe({...body,email:limitedEmail},randomUUID());clock=new Date(+clock+6*60000);}
  assert.equal(calls.length-emailBefore,3);
  // Paris DST: 08:00 occurs at 07:00 UTC in winter and 06:00 UTC in summer.
  for(const [instant,due] of [['2026-01-15T06:59:00Z',false],['2026-01-15T07:00:00Z',true],['2026-07-15T05:59:00Z',false],['2026-07-15T06:00:00Z',true]]) {
    const result=await client.query("SELECT ($1::timestamptz AT TIME ZONE 'Europe/Paris')::time >= '08:00'::time AS due",[instant]);assert.equal(result.rows[0].due,due);
  }
  // Exercise actual provider HTTP contract without sending an email.
  const originalFetch=global.fetch;
  try {
    global.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');assert.equal(options.headers['Idempotency-Key'],'test-key');return new Response(JSON.stringify({id:'provider-test'}),{status:200});};
    assert.equal(await new EmailService().send(rendered,'test-key'),'provider-test');
  } finally {global.fetch=originalFetch;}
  console.log('Digest checks passed: verification, expiry, dedupe, unsubscribe, rate limits, PostGIS, favorite, DST, retries, escaped HTML and Resend contract. No emails sent.');
 } finally {Date.now=originalNow;await client.query('ROLLBACK');client.release();await pool.end();}
})().catch(error=>{console.error(error);process.exitCode=1;});
