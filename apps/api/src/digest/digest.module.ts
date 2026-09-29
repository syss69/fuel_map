import { BadRequestException, Body, Controller, HttpCode, Injectable, Ip, Logger, Module, Post } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DigestService, subscriptionSchema, tokenSchema } from './digest.service';
import { EmailService } from './email.service';

@Controller('api/v1/digest-subscriptions')
export class DigestController {
  constructor(private readonly digest:DigestService){}
  @Post()
  @HttpCode(202)
  create(@Body() body:unknown,@Ip() ip:string){
    const parsed=subscriptionSchema.safeParse(body);
    if(!parsed.success)throw new BadRequestException('Vérifiez votre email, le carburant, la zone et le rayon.');
    return this.digest.subscribe(parsed.data,ip);
  }
  @Post('verify')
  @HttpCode(200)
  verify(@Body() body:unknown){
    const parsed=tokenSchema.safeParse(body);if(!parsed.success)throw new BadRequestException('Lien invalide.');
    return this.digest.verify(parsed.data.token);
  }
  @Post('unsubscribe')
  @HttpCode(200)
  unsubscribe(@Body() body:unknown){
    const parsed=tokenSchema.safeParse(body);if(!parsed.success)throw new BadRequestException('Lien invalide.');
    return this.digest.unsubscribe(parsed.data.token);
  }
}
@Injectable()
export class DigestScheduler {
  private readonly logger=new Logger(DigestScheduler.name);
  constructor(private readonly digest:DigestService){}
  @Cron('*/5 * * * *')
  async run(){try{await this.digest.runMorning();}catch{this.logger.error('Morning digest scheduler failed');}}
}
@Module({controllers:[DigestController],providers:[EmailService,DigestService,DigestScheduler]})
export class DigestModule {}
