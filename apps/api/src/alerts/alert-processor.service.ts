import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as webpush from 'web-push';
import { DatabaseService } from '../database/database.service';
import { getConfig } from '../config';
import { allowedPushEndpoint } from './alerts.service';
@Injectable()
export class PushSender {
 async send(subscription:{endpoint:string;p256dh:string;auth:string},payload:unknown){
  const c=getConfig();
  if(!allowedPushEndpoint(subscription.endpoint))throw Object.assign(new Error('Unsupported push service'),{statusCode:400});
  return webpush.sendNotification({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},JSON.stringify(payload),{TTL:3600,timeout:10000,vapidDetails:{subject:c.VAPID_SUBJECT!,publicKey:c.VAPID_PUBLIC_KEY!,privateKey:c.VAPID_PRIVATE_KEY!}});
 }
}
@Injectable()
export class AlertProcessor {
 private running=false;private readonly logger=new Logger(AlertProcessor.name);
 constructor(private readonly db:DatabaseService,private readonly sender:PushSender){}
 @Interval(5000)
 async tick(){if(this.running)return;this.running=true;try{await this.processEvents();await this.deliver();}catch{this.logger.error('Alert processing failed; pending work will be retried');}finally{this.running=false;}}
 async processEvents(){
  const c=await this.db.pool.connect();
  try{await c.query('BEGIN');
   // Serial ordered processing is essential for the price-drop state machine.
   if(!(await c.query('SELECT pg_try_advisory_xact_lock(640009001) AS locked')).rows[0].locked){await c.query('COMMIT');return;}
   const events=(await c.query(`SELECT e.*,COALESCE(s.display_name,'Station-service') AS name,f.code,f.label FROM fuel_events e JOIN stations s ON s.id=e.station_id JOIN fuel_types f ON f.id=e.fuel_type_id WHERE e.processed_at IS NULL ORDER BY e.id LIMIT 250 FOR UPDATE OF e`)).rows;
   for(const e of events){
    const rules=(await c.query(`SELECT * FROM alert_rules WHERE station_id=$1 AND fuel_type_id=$2 AND status='ACTIVE' AND after_event_id<$3 ORDER BY id FOR UPDATE`,[e.station_id,e.fuel_type_id,e.id])).rows;
    for(const r of rules){
     if(r.event_type==='PRICE_DROP'&&e.type==='PRICE_INCREASED'&&e.current_price_milli_eur>=r.price_threshold_milli_eur){await c.query('UPDATE alert_rules SET price_drop_armed=true,updated_at=now() WHERE id=$1',[r.id]);continue;}
     const fire=(r.event_type==='FUEL_AVAILABLE'&&e.type==='BECAME_AVAILABLE')||(r.event_type==='PRICE_DROP'&&e.type==='PRICE_DECREASED'&&r.price_drop_armed&&r.price_threshold_milli_eur!==null&&e.current_price_milli_eur<r.price_threshold_milli_eur);
     if(!fire)continue;
     const price=(value:number|null)=>value===null?'Prix non renseigné':`${(value/1000).toFixed(3).replace('.',',')}`;
     const title=r.event_type==='FUEL_AVAILABLE'?`${e.label} de nouveau disponible ⛽`:`Baisse du prix du ${e.label}`;
     const body=r.event_type==='FUEL_AVAILABLE'?`${e.name} — ${e.current_price_milli_eur===null?'Prix non renseigné':price(e.current_price_milli_eur)+' €/L'}`:`${e.name} : ${price(e.previous_price_milli_eur)} € → ${price(e.current_price_milli_eur)} €/L`;
     const n=(await c.query(`INSERT INTO notification_events(subscriber_id,alert_rule_id,fuel_event_id,type,title,body,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(alert_rule_id,fuel_event_id) DO NOTHING RETURNING id`,[r.subscriber_id,r.id,e.id,r.event_type,title,body,{stationId:e.station_id,fuelCode:e.code}])).rows[0];
     if(n)await c.query(`INSERT INTO push_deliveries(notification_event_id,push_subscription_id) SELECT $1,id FROM push_subscriptions WHERE subscriber_id=$2 AND revoked_at IS NULL ON CONFLICT DO NOTHING`,[n.id,r.subscriber_id]);
     await c.query(`UPDATE alert_rules SET price_drop_armed=CASE WHEN event_type='PRICE_DROP' THEN false ELSE NULL END,status=CASE WHEN frequency='ONCE' THEN 'COMPLETED' ELSE status END,completed_at=CASE WHEN frequency='ONCE' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1`,[r.id]);
    }
    await c.query('UPDATE fuel_events SET processed_at=now() WHERE id=$1',[e.id]);
   }
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async deliver(){
  const config=getConfig();if(!config.VAPID_PUBLIC_KEY||!config.VAPID_PRIVATE_KEY||!config.VAPID_SUBJECT)return;
  const c=await this.db.pool.connect();let locked=false;
  try{
   locked=(await c.query('SELECT pg_try_advisory_lock(640009002) AS locked')).rows[0].locked;if(!locked)return;
   await c.query(`UPDATE push_deliveries SET status='FAILED',failed_at=now(),last_error='Delivery expired or attempts exhausted' WHERE status='PENDING' AND (created_at<now()-interval '1 hour' OR attempt_count>=5)`);
   const rows=(await c.query(`SELECT d.id,d.attempt_count,d.push_subscription_id,p.endpoint,p.p256dh,p.auth,p.revoked_at,r.status AS rule_status,n.id AS notification_id,n.title,n.body,n.payload FROM push_deliveries d JOIN push_subscriptions p ON p.id=d.push_subscription_id JOIN notification_events n ON n.id=d.notification_event_id JOIN alert_rules r ON r.id=n.alert_rule_id WHERE d.status='PENDING' AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=now()) ORDER BY d.created_at,d.id LIMIT 50`)).rows;
   for(const d of rows){
    const live=(await c.query(`SELECT p.revoked_at,r.status FROM push_subscriptions p JOIN notification_events n ON n.id=$2 JOIN alert_rules r ON r.id=n.alert_rule_id WHERE p.id=$1`,[d.push_subscription_id,d.notification_id])).rows[0];
    d.revoked_at=live?.revoked_at;d.rule_status=live?.status;
    if(d.revoked_at||d.rule_status==='DISABLED'){await c.query(`UPDATE push_deliveries SET status='FAILED',failed_at=now(),last_error='Device or rule disabled' WHERE id=$1`,[d.id]);continue;}
    const claimed=await c.query(`UPDATE push_deliveries SET attempt_count=attempt_count+1,next_attempt_at=now()+interval '2 minutes' WHERE id=$1 AND status='PENDING' RETURNING id`,[d.id]);if(!claimed.rowCount)continue;
    try{
     await this.sender.send(d,{id:d.notification_id,title:d.title,body:d.body,...d.payload});
     await c.query(`UPDATE push_deliveries SET status='SENT',sent_at=now(),last_error=NULL,next_attempt_at=NULL WHERE id=$1`,[d.id]);
    }catch(error){
     const status=Number((error as {statusCode?:number}).statusCode)||0;
     const retry=(status===0||status===429||status>=500)&&d.attempt_count+1<5;
     if(status===404||status===410)await c.query('UPDATE push_subscriptions SET revoked_at=now() WHERE id=$1',[d.push_subscription_id]);
     await c.query(`UPDATE push_deliveries SET status=$2,last_error=$3,failed_at=CASE WHEN $2='FAILED' THEN now() ELSE NULL END,next_attempt_at=CASE WHEN $2='PENDING' THEN now()+make_interval(secs=>$4) ELSE NULL END WHERE id=$1`,[d.id,retry?'PENDING':'FAILED',status?`Push provider HTTP ${status}`:'Push connection failed',Math.min(1800,30*2**d.attempt_count)]);
    }
   }
  }finally{if(locked)await c.query('SELECT pg_advisory_unlock(640009002)');c.release();}
 }
}
