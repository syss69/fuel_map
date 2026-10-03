import { HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { getConfig } from '../config';
import { PushSender } from './alert-processor.service';
@Injectable()
export class TestPushService {
 constructor(private readonly db:DatabaseService,private readonly sender:PushSender){}
 async send(subscriber:string,deviceId:string){
  const device=(await this.db.pool.query('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE id=$1 AND subscriber_id=$2 AND revoked_at IS NULL',[deviceId,subscriber])).rows[0];
  if(!device)throw new NotFoundException('Cet appareil est inconnu ou désactivé. Réactivez les notifications.');
  const config=getConfig();if(!config.VAPID_PUBLIC_KEY||!config.VAPID_PRIVATE_KEY||!config.VAPID_SUBJECT)throw new ServiceUnavailableException('Les notifications sont temporairement indisponibles.');
  // Atomic subscriber-wide cooldown; shared across API instances and devices.
  const limit=await this.db.pool.query(`INSERT INTO subscriber_rate_limits(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET window_started_at=now(),hits=1 WHERE subscriber_rate_limits.window_started_at<=now()-interval '30 seconds' RETURNING key`,[`push-test:${subscriber}`]);
  if(!limit.rowCount)throw new HttpException('Patientez 30 secondes avant un nouveau test.',429);
  try{
   await this.sender.send(device,{id:randomUUID(),title:'Notification de test Trajetico',body:'Si vous voyez ce message, les notifications fonctionnent sur cet appareil.'});
  }catch(error){
   const status=Number((error as {statusCode?:number}).statusCode)||0;
   if(status===404||status===410){await this.db.pool.query('UPDATE push_subscriptions SET revoked_at=now() WHERE id=$1 AND subscriber_id=$2',[deviceId,subscriber]);throw new ServiceUnavailableException('L’abonnement de cet appareil a expiré. Réactivez les notifications, puis réessayez.');}
   throw new ServiceUnavailableException('Le test n’a pas pu être envoyé. Réessayez dans quelques instants.');
  }
  return {message:'Test accepté par le service push. Vérifiez les notifications de votre appareil. Si rien ne s’affiche, vérifiez aussi le mode Ne pas déranger et les réglages système.'};
 }
}
