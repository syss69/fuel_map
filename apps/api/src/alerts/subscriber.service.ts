import { BadRequestException, Injectable, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../digest/email.service';
import { getConfig } from '../config';
export const hashToken=(value:string)=>createHash('sha256').update(value).digest('hex');
export const SESSION_COOKIE='trajetico_session';
@Injectable()
export class SubscriberService {
 constructor(private readonly db:DatabaseService,private readonly email:EmailService){}
 async request(email:string,ip:string){
  const config=getConfig();
  if(!config.RESEND_API_KEY)throw new ServiceUnavailableException('Connexion par email temporairement indisponible.');
  const neutral={message:'Si cette demande peut être traitée, vous recevrez un lien de connexion par email.'};
  const client=await this.db.pool.connect();let token='',id='';
  try{
   await client.query('BEGIN');
   for(const [key,limit,seconds] of [[`ip:${hashToken(ip)}`,10,3600],[`email:${hashToken(email)}`,3,86400]] as const){
    const r=await client.query(`INSERT INTO subscriber_rate_limits(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN subscriber_rate_limits.window_started_at<=now()-make_interval(secs=>$2) THEN 1 ELSE subscriber_rate_limits.hits+1 END,window_started_at=CASE WHEN subscriber_rate_limits.window_started_at<=now()-make_interval(secs=>$2) THEN now() ELSE subscriber_rate_limits.window_started_at END RETURNING hits`,[key,seconds]);
    if(r.rows[0].hits>limit){await client.query('COMMIT');return neutral;}
   }
   id=(await client.query(`INSERT INTO subscribers(email) VALUES($1) ON CONFLICT(email) DO UPDATE SET updated_at=now() RETURNING id`,[email])).rows[0].id;
   const recent=await client.query(`SELECT 1 FROM subscriber_magic_links WHERE subscriber_id=$1 AND created_at>now()-interval '5 minutes'`,[id]);
   if(recent.rowCount){await client.query('COMMIT');return neutral;}
   token=randomBytes(32).toString('base64url');
   await client.query('DELETE FROM subscriber_magic_links WHERE subscriber_id=$1',[id]);
   await client.query(`INSERT INTO subscriber_magic_links(token_hash,subscriber_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')`,[hashToken(token),id]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  const url=new URL('/mes-alertes',config.PUBLIC_APP_URL||config.FRONTEND_ORIGIN);url.hash=token;
  try{await this.email.send({from:config.EMAIL_FROM||'Trajetico <bonjour@trajetico.space>',to:[email],subject:'Votre lien de connexion Trajetico',text:`Accéder à mes alertes : ${url}\nCe lien est valable 30 minutes et utilisable une seule fois. Si vous n’avez pas demandé ce lien, ignorez cet email.`,html:`<h1>Mes alertes Trajetico</h1><p><a href="${url.toString().replace(/&/g,'&amp;')}">Accéder à mes alertes</a></p><p>Ce lien expire dans 30 minutes et ne peut être utilisé qu’une fois. Ignorez cet email si vous ne l’avez pas demandé.</p>`},`login/${hashToken(token)}`);}catch{ /* Neutral response avoids account enumeration; no secrets in logs. */ }
  return neutral;
 }
 async verify(token:string){
  const client=await this.db.pool.connect();
  try{await client.query('BEGIN');
   const link=(await client.query('DELETE FROM subscriber_magic_links WHERE token_hash=$1 AND expires_at>now() RETURNING subscriber_id',[hashToken(token)])).rows[0];
   if(!link)throw new BadRequestException('Lien invalide ou expiré. Demandez un nouveau lien.');
   await client.query('UPDATE subscribers SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=$1',[link.subscriber_id]);
   const session=randomBytes(32).toString('base64url');
   await client.query(`INSERT INTO subscriber_sessions(token_hash,subscriber_id,expires_at) VALUES($1,$2,now()+interval '90 days')`,[hashToken(session),link.subscriber_id]);
   await client.query('COMMIT');return session;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 async current(cookie?:string){
  const token=cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length+1);
  if(!token || !/^[A-Za-z0-9_-]{43}$/.test(token))throw new UnauthorizedException('Connectez-vous pour gérer vos alertes.');
  const row=(await this.db.pool.query(`SELECT s.id,s.email FROM subscriber_sessions session JOIN subscribers s ON s.id=session.subscriber_id WHERE session.token_hash=$1 AND session.expires_at>now() AND s.email_verified_at IS NOT NULL`,[hashToken(token)])).rows[0];
  if(!row)throw new UnauthorizedException('Votre session a expiré.');return row as {id:string;email:string};
 }
 async logout(cookie?:string){
  const token=cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length+1);
  if(token)await this.db.pool.query('DELETE FROM subscriber_sessions WHERE token_hash=$1',[hashToken(token)]);
 }
}
