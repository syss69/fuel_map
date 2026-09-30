import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service';
export const ruleSchema=z.object({stationId:z.string().uuid(),fuelCode:z.enum(['GAZOLE','SP95','SP98','E10','E85','GPLC']),eventType:z.enum(['FUEL_AVAILABLE','PRICE_DROP']),frequency:z.enum(['ONCE','RECURRING']),status:z.enum(['ACTIVE','DISABLED']),priceThresholdMilliEur:z.number().int().positive().max(2147483647).nullable().optional()}).strict().refine(r=>r.eventType!=='PRICE_DROP'||r.status!=='ACTIVE'||r.priceThresholdMilliEur!=null,'Indiquez un seuil de prix positif.');
export const pushSchema=z.object({endpoint:z.string().url().max(4096),keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]+$/).refine(x=>Buffer.from(x,'base64url').length===65),auth:z.string().regex(/^[A-Za-z0-9_-]+$/).refine(x=>Buffer.from(x,'base64url').length===16)}).strict(),deviceLabel:z.string().trim().max(100).optional()}).strict();
export function allowedPushEndpoint(endpoint:string){
 const url=new URL(endpoint);const host=url.hostname;
 // Only trusted browser push services, never arbitrary URLs (SSRF).
 return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&!url.hash&&
 (host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.push.services.mozilla.com')||host==='web.push.apple.com'||host.endsWith('.notify.windows.com'));
}
@Injectable()
export class AlertsService {
 constructor(private readonly db:DatabaseService){}
 async list(subscriber:string){return (await this.db.pool.query(`SELECT r.id,r.station_id AS "stationId",COALESCE(s.display_name,'Station-service') AS "stationName",f.code AS "fuelCode",f.label AS "fuelLabel",r.event_type AS "eventType",r.frequency,r.status,r.price_threshold_milli_eur AS "priceThresholdMilliEur" FROM alert_rules r JOIN stations s ON s.id=r.station_id JOIN fuel_types f ON f.id=r.fuel_type_id WHERE r.subscriber_id=$1 ORDER BY s.display_name,s.id,f.id,r.event_type`,[subscriber])).rows;}
 async save(subscriber:string,input:z.infer<typeof ruleSchema>){
  const c=await this.db.pool.connect();
  try{await c.query('BEGIN');
   // Same station lock as importer: baseline cannot miss an in-flight official update.
   if(!(await c.query('SELECT id FROM stations WHERE id=$1 FOR UPDATE',[input.stationId])).rowCount)throw new NotFoundException('Station inconnue');
   const fuel=(await c.query('SELECT id FROM fuel_types WHERE code=$1',[input.fuelCode])).rows[0];
   if(!fuel)throw new BadRequestException('Carburant inconnu');
   const after=(await c.query('SELECT COALESCE(max(id),0) AS id FROM fuel_events WHERE station_id=$1 AND fuel_type_id=$2',[input.stationId,fuel.id])).rows[0].id;
   const row=(await c.query(`INSERT INTO alert_rules(subscriber_id,station_id,fuel_type_id,event_type,frequency,status,price_drop_armed,after_event_id,price_threshold_milli_eur)
    VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $4='PRICE_DROP' THEN true ELSE NULL END,$7,$8)
    ON CONFLICT(subscriber_id,station_id,fuel_type_id,event_type) DO UPDATE SET
    frequency=EXCLUDED.frequency,status=EXCLUDED.status,
    after_event_id=CASE WHEN alert_rules.status='ACTIVE' AND EXCLUDED.status='ACTIVE' AND alert_rules.price_threshold_milli_eur IS NOT DISTINCT FROM EXCLUDED.price_threshold_milli_eur THEN alert_rules.after_event_id ELSE EXCLUDED.after_event_id END,
    price_drop_armed=CASE WHEN alert_rules.status='ACTIVE' AND EXCLUDED.status='ACTIVE' AND alert_rules.price_threshold_milli_eur IS NOT DISTINCT FROM EXCLUDED.price_threshold_milli_eur THEN alert_rules.price_drop_armed ELSE EXCLUDED.price_drop_armed END,
    price_threshold_milli_eur=EXCLUDED.price_threshold_milli_eur,completed_at=NULL,updated_at=now() RETURNING id`,[subscriber,input.stationId,fuel.id,input.eventType,input.frequency,input.status,after,input.eventType==='PRICE_DROP'?(input.priceThresholdMilliEur??null):null])).rows[0];
   if(input.status==='DISABLED')await c.query(`UPDATE push_deliveries SET status='FAILED',failed_at=now(),last_error='Rule disabled' WHERE status='PENDING' AND notification_event_id IN (SELECT id FROM notification_events WHERE alert_rule_id=$1)`,[row.id]);
   await c.query('COMMIT');return {id:row.id};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async disableAll(subscriber:string){
  const c=await this.db.pool.connect();try{await c.query('BEGIN');
   await c.query(`UPDATE alert_rules SET status='DISABLED',updated_at=now() WHERE subscriber_id=$1`,[subscriber]);
   await c.query(`UPDATE push_deliveries SET status='FAILED',failed_at=now(),last_error='Alerts disabled' WHERE status='PENDING' AND notification_event_id IN (SELECT id FROM notification_events WHERE subscriber_id=$1)`,[subscriber]);
   await c.query('COMMIT');return {ok:true};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async register(subscriber:string,body:z.infer<typeof pushSchema>,ua?:string){
  if(!allowedPushEndpoint(body.endpoint))throw new BadRequestException('Service push non pris en charge.');
  const row=(await this.db.pool.query(`INSERT INTO push_subscriptions(subscriber_id,endpoint,p256dh,auth,user_agent,device_label) VALUES($1,$2,$3,$4,$5,$6)
   ON CONFLICT(endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,user_agent=EXCLUDED.user_agent,device_label=EXCLUDED.device_label,updated_at=now(),last_seen_at=now(),revoked_at=NULL
   WHERE push_subscriptions.subscriber_id=EXCLUDED.subscriber_id RETURNING id`,[subscriber,body.endpoint,body.keys.p256dh,body.keys.auth,ua?.slice(0,500),body.deviceLabel||'Navigateur'])).rows[0];
  if(!row)throw new BadRequestException('Cet appareil est associé à un autre email. Désactivez son abonnement push avant de changer de compte.');return row;
 }
 async devices(subscriber:string){return (await this.db.pool.query('SELECT id,device_label AS "deviceLabel",last_seen_at AS "lastSeenAt",revoked_at AS "revokedAt" FROM push_subscriptions WHERE subscriber_id=$1 ORDER BY created_at',[subscriber])).rows;}
 async revoke(subscriber:string,id:string){
  const c=await this.db.pool.connect();try{await c.query('BEGIN');
   if(!(await c.query('UPDATE push_subscriptions SET revoked_at=now() WHERE id=$1 AND subscriber_id=$2 RETURNING id',[id,subscriber])).rowCount)throw new NotFoundException('Appareil inconnu');
   await c.query(`UPDATE push_deliveries SET status='FAILED',failed_at=now(),last_error='Device revoked' WHERE push_subscription_id=$1 AND status='PENDING'`,[id]);await c.query('COMMIT');return {ok:true};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
}
