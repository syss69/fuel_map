import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service';
import { getConfig } from '../config';
import { EmailFailure, EmailMessage, EmailService } from './email.service';
import { digestEmail, DigestSnapshot, DigestStation, verificationEmail } from './email.templates';

export const subscriptionSchema = z.object({
  email: z.string().trim().email().max(254).transform(s=>s.toLowerCase()),
  fuelCode: z.enum(['GAZOLE','SP95','SP98','E10','E85','GPLC']),
  lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180),
  radiusMeters: z.union([z.literal(5000),z.literal(10000),z.literal(15000)]),
  favoriteStationId: z.string().uuid().nullable().optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(3)
    .refine(days=>new Set(days).size===days.length,'Choisissez des jours différents.')
    .transform(days=>[...days].sort((a,b)=>a-b)),
}).strict();
export const tokenSchema = z.object({token:z.string().min(40).max(160).regex(/^[A-Za-z0-9_.-]+$/)}).strict();
export const digestSettingsSchema = subscriptionSchema.omit({email:true}).extend({favoriteStationId:z.string().uuid().nullable()});
export const digestStatusSchema = z.object({status:z.enum(['ACTIVE','UNSUBSCRIBED'])}).strict();
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const neutral = {message:'Si cette demande peut être traitée, vous recevrez un email pour confirmer votre abonnement.'};
interface Subscription { id:string; email:string; status:string; unsubscribe_nonce:string; last_confirmation_at:Date|null; fuel_type_id:number; timezone:string; favorite_station_id:string|null }
interface Delivery { id:string; status:string; created_at:Date; attempts:number; payload:{message:EmailMessage; appUrl:string; nonce:string} }

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);
  constructor(private readonly db: DatabaseService, private readonly email: EmailService) {}
  async current(subscriberId:string, client:Pick<PoolClient,'query'>=this.db.pool) {
    const {rows}=await client.query(`SELECT d.status, f.code AS "fuelCode",
      ST_Y(d.center::geometry) AS lat, ST_X(d.center::geometry) AS lng,
      d.radius_meters AS "radiusMeters", d.weekdays, d.favorite_station_id AS "favoriteStationId",
      CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object('id',s.id,'displayName',coalesce(s.display_name,'Station-service'),
        'address',s.address,'city',s.city,'lat',ST_Y(s.location::geometry),'lng',ST_X(s.location::geometry)) END AS "favoriteStation"
      FROM digest_subscriptions d JOIN fuel_types f ON f.id=d.fuel_type_id
      LEFT JOIN stations s ON s.id=d.favorite_station_id WHERE d.subscriber_id=$1`,[subscriberId]);
    return rows[0] ?? null;
  }
  private async manage(subscriberId:string, change:(client:PoolClient,id:string)=>Promise<void>) {
    const client=await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const sub=(await client.query<{id:string}>('SELECT id FROM digest_subscriptions WHERE subscriber_id=$1',[subscriberId])).rows[0];
      if(!sub)throw new NotFoundException('Aucun abonnement au digest.');
      // Same lock and ordering as delivery, unsubscribe and public resubscription.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 2))',[sub.id]);
      if(!(await client.query('SELECT id FROM digest_subscriptions WHERE id=$1 AND subscriber_id=$2 FOR UPDATE',[sub.id,subscriberId])).rowCount)
        throw new NotFoundException('Aucun abonnement au digest.');
      await change(client,sub.id);
      const result=await this.current(subscriberId,client);
      await client.query('COMMIT');
      return result;
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  }
  async updateSettings(subscriberId:string, body:z.infer<typeof digestSettingsSchema>) {
    return this.manage(subscriberId,async(client,id)=>{
      const fuel=(await client.query<{id:number}>('SELECT id FROM fuel_types WHERE code=$1',[body.fuelCode])).rows[0];
      if(!fuel)throw new BadRequestException('Carburant inconnu.');
      if(body.favoriteStationId && !(await client.query('SELECT id FROM stations WHERE id=$1',[body.favoriteStationId])).rowCount)
        throw new BadRequestException('Station favorite inconnue.');
      await client.query(`UPDATE digest_subscriptions SET fuel_type_id=$2,
        center=ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,radius_meters=$5,
        favorite_station_id=$6,weekdays=$7,updated_at=now() WHERE id=$1`,
        [id,fuel.id,body.lng,body.lat,body.radiusMeters,body.favoriteStationId,body.weekdays]);
    });
  }
  async updateStatus(subscriberId:string, status:'ACTIVE'|'UNSUBSCRIBED') {
    return this.manage(subscriberId,async(client,id)=>{
      await client.query(`UPDATE digest_subscriptions SET status=$2::digest_subscription_status,
        verified_at=CASE WHEN $2='ACTIVE' THEN coalesce(verified_at,now()) ELSE verified_at END,
        verification_token_hash=NULL,verification_expires_at=NULL,updated_at=now() WHERE id=$1`,[id,status]);
      if(status==='UNSUBSCRIBED')await client.query(`UPDATE email_deliveries SET status='CANCELLED'
        WHERE subscription_id=$1 AND type='MORNING_DIGEST' AND status IN ('PENDING','RETRY')`,[id]);
    });
  }
  private settings() {
    const c=getConfig();
    if(c.DIGEST_ENABLED!=='true' || !c.RESEND_API_KEY || !c.DIGEST_TOKEN_SECRET) throw new ServiceUnavailableException('Les abonnements email sont temporairement indisponibles.');
    return {secret:c.DIGEST_TOKEN_SECRET,from:c.EMAIL_FROM?.trim() || 'Trajetico <bonjour@trajetico.space>',appUrl:c.PUBLIC_APP_URL ?? c.FRONTEND_ORIGIN};
  }
  private unsubscribeToken(id:string, nonce:string) {
    return createHmac('sha256',this.settings().secret).update(`unsubscribe:${id}:${nonce}`).digest('base64url');
  }
  private link(base:string, action:'verify'|'unsubscribe', token:string) {
    const url=new URL(base); url.searchParams.set('digest',action); url.hash=token; return url.toString();
  }
  private async limit(client:PoolClient, key:string, seconds:number, max:number) {
    const {rows}=await client.query<{hits:number}>(`INSERT INTO digest_rate_limits(key,window_started_at) VALUES($1,now())
      ON CONFLICT(key) DO UPDATE SET
        hits=CASE WHEN digest_rate_limits.window_started_at<=now()-make_interval(secs=>$2) THEN 1 ELSE digest_rate_limits.hits+1 END,
        window_started_at=CASE WHEN digest_rate_limits.window_started_at<=now()-make_interval(secs=>$2) THEN now() ELSE digest_rate_limits.window_started_at END
      RETURNING hits`,[key,seconds]);
    return rows[0].hits<=max;
  }
  async subscribe(body:z.infer<typeof subscriptionSchema>, ip:string) {
    const settings=this.settings();
    const client=await this.db.pool.connect();
    let pending:{deliveryId:string; message:EmailMessage}|undefined;
    try {
      await client.query('BEGIN');
      const fuel=(await client.query<{id:number;label:string}>('SELECT id,label FROM fuel_types WHERE code=$1',[body.fuelCode])).rows[0];
      if(!fuel) throw new BadRequestException('Carburant inconnu');
      if(body.favoriteStationId && !(await client.query('SELECT id FROM stations WHERE id=$1',[body.favoriteStationId])).rowCount) throw new BadRequestException('Station favorite inconnue');
      if(!await this.limit(client,`ip:${tokenHash(ip)}`,3600,10)) {await client.query('COMMIT');return neutral;}
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))',[body.email]);
      const existing=(await client.query<{id:string}>('SELECT id FROM digest_subscriptions WHERE email=$1',[body.email])).rows[0];
      if(existing)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 2))',[existing.id]);
      const old=(await client.query<Subscription>('SELECT * FROM digest_subscriptions WHERE email=$1 FOR UPDATE',[body.email])).rows[0];
      if(old?.status==='ACTIVE' || (old?.last_confirmation_at && Date.now()-old.last_confirmation_at.getTime()<300000)) {await client.query('COMMIT');return neutral;}
      if(!await this.limit(client,`email:${tokenHash(body.email)}`,86400,3)) {await client.query('COMMIT');return neutral;}
      const id=old?.id ?? randomUUID(), nonce=randomUUID(), token=randomBytes(32).toString('base64url');
      await client.query(`INSERT INTO digest_subscriptions(id,email,fuel_type_id,center,radius_meters,favorite_station_id,
        verification_token_hash,verification_expires_at,unsubscribe_token_hash,unsubscribe_nonce,last_confirmation_at,weekdays)
        VALUES($1,$2,$3,ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,$6,$7,$8,now()+interval '24 hours',$9,$10,now(),$11)
        ON CONFLICT(email) DO UPDATE SET fuel_type_id=EXCLUDED.fuel_type_id,center=EXCLUDED.center,radius_meters=EXCLUDED.radius_meters,
          favorite_station_id=EXCLUDED.favorite_station_id,status='PENDING',verification_token_hash=EXCLUDED.verification_token_hash,
          verification_expires_at=EXCLUDED.verification_expires_at,unsubscribe_token_hash=EXCLUDED.unsubscribe_token_hash,
          unsubscribe_nonce=EXCLUDED.unsubscribe_nonce,weekdays=EXCLUDED.weekdays,verified_at=NULL,last_confirmation_at=now(),updated_at=now()`,
        [id,body.email,fuel.id,body.lng,body.lat,body.radiusMeters,body.favoriteStationId ?? null,tokenHash(token),tokenHash(this.unsubscribeToken(id,nonce)),nonce,body.weekdays]);
      const deliveryId=randomUUID();
      await client.query(`INSERT INTO email_deliveries(id,subscription_id,type,recipient,attempts) VALUES($1,$2,'VERIFICATION',$3,1)`,[deliveryId,id,body.email]);
      const summary=`Les 3 stations les moins chères pour ${fuel.label}, dans un rayon de ${body.radiusMeters/1000} km autour de ${body.lat.toFixed(5)}, ${body.lng.toFixed(5)}${body.favoriteStationId ? ', avec votre station favorite' : ''}.`;
      const days=body.weekdays.map(day=>['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'][day-1]).join(', ');
      pending={deliveryId,message:verificationEmail(settings.from,body.email,this.link(settings.appUrl,'verify',token),`${summary} Jours choisis : ${days}.`)};
      await client.query('COMMIT');
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
    if(pending) {
      try {
        const providerId=await this.email.send(pending.message,`verification/${pending.deliveryId}`);
        await this.db.pool.query(`UPDATE email_deliveries SET status='SENT',provider_message_id=$2,sent_at=now() WHERE id=$1`,[pending.deliveryId,providerId]);
      } catch(error) {
        await this.db.pool.query(`UPDATE email_deliveries SET status='FAILED',last_error=$2 WHERE id=$1`,[pending.deliveryId,error instanceof EmailFailure ? error.message : 'Verification send could not be completed']);
        this.logger.warn(`Verification delivery ${pending.deliveryId} failed`);
      }
    }
    return neutral;
  }
  async verify(token:string) {
    const client=await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const sub=(await client.query<{id:string}>('SELECT id FROM digest_subscriptions WHERE verification_token_hash=$1',[tokenHash(token)])).rows[0];
      if(sub)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 2))',[sub.id]);
      const result=await client.query(`UPDATE digest_subscriptions SET status='ACTIVE',verified_at=now(),updated_at=now(),
        verification_token_hash=NULL,verification_expires_at=NULL
        WHERE verification_token_hash=$1 AND status='PENDING' AND verification_expires_at>now() RETURNING id`,[tokenHash(token)]);
      if(!result.rowCount)throw new BadRequestException('Ce lien est invalide ou a expiré. Demandez un nouvel email de confirmation.');
      await client.query('COMMIT');
      return {message:'Votre abonnement est confirmé.'};
    } catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
  }
  async unsubscribe(token:string) {
    const client=await this.db.pool.connect();
    try {
      const sub=(await client.query<{id:string}>('SELECT id FROM digest_subscriptions WHERE unsubscribe_token_hash=$1',[tokenHash(token)])).rows[0];
      if(!sub) throw new BadRequestException('Ce lien est invalide.');
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 2))',[sub.id]);
      const result=await client.query(`UPDATE digest_subscriptions SET status='UNSUBSCRIBED',updated_at=now(),verification_token_hash=NULL,verification_expires_at=NULL
        WHERE id=$1 AND unsubscribe_token_hash=$2 RETURNING id`,[sub.id,tokenHash(token)]);
      if(!result.rowCount) throw new BadRequestException('Ce lien est invalide.');
      await client.query(`UPDATE email_deliveries SET status='CANCELLED' WHERE subscription_id=$1 AND type='MORNING_DIGEST' AND status IN ('PENDING','RETRY')`,[sub.id]);
      await client.query('COMMIT');
      return {message:'Votre abonnement a été annulé.'};
    } catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
  }
  async snapshot(client:PoolClient, subscriptionId:string, localDate:string):Promise<DigestSnapshot> {
    const settings=this.settings();
    const info=(await client.query<{email:string;label:string;favorite_station_id:string|null}>(`SELECT s.email,ft.label,s.favorite_station_id FROM digest_subscriptions s JOIN fuel_types ft ON ft.id=s.fuel_type_id WHERE s.id=$1`,[subscriptionId])).rows[0];
    const fields=`ST_Y(s.location::geometry) AS lat,ST_X(s.location::geometry) AS lng,s.id,COALESCE(s.display_name,'Station-service') AS name,s.address,s.city,
      f.price_milli_eur AS price,COALESCE(f.availability::text,'UNKNOWN') AS availability,ST_Distance(s.location,d.center) AS distance,
      f.source_price_updated_at AS source_updated_at,s.last_seen_at`;
    const top=(await client.query<DigestStation>(`SELECT ${fields} FROM digest_subscriptions d
      JOIN stations s ON ST_DWithin(s.location,d.center,d.radius_meters)
      JOIN station_fuels f ON f.station_id=s.id AND f.fuel_type_id=d.fuel_type_id
      WHERE d.id=$1 AND s.last_seen_at>=now()-interval '24 hours' AND f.availability='AVAILABLE' AND f.price_milli_eur>0
      ORDER BY f.price_milli_eur ASC,distance ASC,s.id ASC LIMIT 3`,[subscriptionId])).rows;
    const favorite=info.favorite_station_id ? (await client.query<DigestStation>(`SELECT ${fields} FROM digest_subscriptions d
      JOIN stations s ON s.id=d.favorite_station_id LEFT JOIN station_fuels f ON f.station_id=s.id AND f.fuel_type_id=d.fuel_type_id WHERE d.id=$1`,[subscriptionId])).rows[0] ?? null : null;
    return JSON.parse(JSON.stringify({from:settings.from,appUrl:settings.appUrl,recipient:info.email,fuel:info.label,date:localDate,top,favorite}));
  }
  async runMorning() {
    try {this.settings();} catch{return;}
    const client=await this.db.pool.connect(); let locked=false;
    try {
      locked=(await client.query<{locked:boolean}>('SELECT pg_try_advisory_lock(6400080003) AS locked')).rows[0].locked;
      if(!locked)return;
      const candidates=(await client.query<{id:string}>(`SELECT s.id FROM digest_subscriptions s
        LEFT JOIN email_deliveries d ON d.subscription_id=s.id AND d.type='MORNING_DIGEST' AND d.local_date=(now() AT TIME ZONE s.timezone)::date
        WHERE s.status='ACTIVE' AND (now() AT TIME ZONE s.timezone)::time>=s.send_time
          AND extract(isodow FROM now() AT TIME ZONE s.timezone)::int=ANY(s.weekdays)
          AND (SELECT count(*) FROM email_deliveries sent WHERE sent.subscription_id=s.id AND sent.type='MORNING_DIGEST' AND sent.status='SENT'
            AND (sent.sent_at AT TIME ZONE s.timezone)>=date_trunc('week',now() AT TIME ZONE s.timezone))<3
          AND (s.last_sent_at IS NULL OR (s.last_sent_at AT TIME ZONE s.timezone)::date<(now() AT TIME ZONE s.timezone)::date)
          AND (d.id IS NULL OR (d.status IN ('PENDING','RETRY') AND d.attempts<5))
        ORDER BY s.last_sent_at NULLS FIRST,s.id LIMIT 50`)).rows;
      for(const candidate of candidates) {
        try{await this.sendMorning(client,candidate.id);}catch{this.logger.error(`Digest processing failed for subscription ${candidate.id}`);}
        await new Promise(resolve=>setTimeout(resolve,550));
      }
    } finally {
      if(locked)await client.query('SELECT pg_advisory_unlock(6400080003)');
      client.release();
    }
  }
  private async sendMorning(client:PoolClient,id:string) {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 2))',[id]);
    try {
      const sub=(await client.query<Subscription & {local_date:string}>(`SELECT *,to_char(now() AT TIME ZONE timezone,'YYYY-MM-DD') AS local_date
        FROM digest_subscriptions WHERE id=$1 AND status='ACTIVE' AND (now() AT TIME ZONE timezone)::time>=send_time
        AND extract(isodow FROM now() AT TIME ZONE timezone)::int=ANY(weekdays)
        AND (SELECT count(*) FROM email_deliveries sent WHERE sent.subscription_id=digest_subscriptions.id AND sent.type='MORNING_DIGEST' AND sent.status='SENT'
          AND (sent.sent_at AT TIME ZONE timezone)>=date_trunc('week',now() AT TIME ZONE timezone))<3
        AND (last_sent_at IS NULL OR (last_sent_at AT TIME ZONE timezone)::date<(now() AT TIME ZONE timezone)::date)`,[id])).rows[0];
      if(!sub)return;
      let delivery=(await client.query<Delivery>(`SELECT * FROM email_deliveries WHERE subscription_id=$1 AND type='MORNING_DIGEST' AND local_date=$2`,[id,sub.local_date])).rows[0];
      if(!delivery) {
        const snapshot=await this.snapshot(client,id,sub.local_date);
        const payload={message:digestEmail(snapshot,'__UNSUBSCRIBE_URL__'),appUrl:snapshot.appUrl,nonce:sub.unsubscribe_nonce};
        delivery=(await client.query<Delivery>(`INSERT INTO email_deliveries(subscription_id,type,recipient,local_date,payload)
          VALUES($1,'MORNING_DIGEST',$2,$3,$4) ON CONFLICT(subscription_id,type,local_date) DO UPDATE SET subscription_id=EXCLUDED.subscription_id RETURNING *`,[id,sub.email,sub.local_date,payload])).rows[0];
      }
      if(!['PENDING','RETRY'].includes(delivery.status) || delivery.attempts>=5)return;
      if(Date.now()-delivery.created_at.getTime()>23*3600000) {
        await client.query(`UPDATE email_deliveries SET status='UNKNOWN',last_error='Retry window expired; manual reconciliation required' WHERE id=$1`,[delivery.id]);return;
      }
      const url=this.link(delivery.payload.appUrl,'unsubscribe',this.unsubscribeToken(id,delivery.payload.nonce));
      const message={...delivery.payload.message,html:delivery.payload.message.html.replaceAll('__UNSUBSCRIBE_URL__',url.replace(/&/g,'&amp;')),text:delivery.payload.message.text.replaceAll('__UNSUBSCRIBE_URL__',url)};
      await client.query('UPDATE email_deliveries SET attempts=attempts+1 WHERE id=$1',[delivery.id]);
      let providerId:string;
      try{providerId=await this.email.send(message,`digest/${delivery.id}`);}catch(error){
        const retry=!(error instanceof EmailFailure) || error.retryable;
        await client.query(`UPDATE email_deliveries SET status=$2,last_error=$3 WHERE id=$1`,[delivery.id,retry?'RETRY':'FAILED',error instanceof EmailFailure?error.message:'Email delivery attempt failed']);return;
      }
      await client.query('BEGIN');
      try {
        await client.query(`UPDATE email_deliveries SET status='SENT',provider_message_id=$2,sent_at=now(),last_error=NULL WHERE id=$1`,[delivery.id,providerId]);
        await client.query('UPDATE digest_subscriptions SET last_sent_at=now(),updated_at=now() WHERE id=$1',[id]);
        await client.query('COMMIT');
      } catch(error){await client.query('ROLLBACK');throw error;}
    } finally {await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 2))',[id]);}
  }
}
