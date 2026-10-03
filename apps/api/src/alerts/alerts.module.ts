import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Ip, Module, Param, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { getConfig } from '../config';
import { EmailService } from '../digest/email.service';
import { SubscriberService, SESSION_COOKIE } from './subscriber.service';
import { AlertsService, ruleSchema, pushSchema } from './alerts.service';
import { AlertProcessor, PushSender } from './alert-processor.service';
import { TestPushService } from './test-push.service';
const login=z.object({email:z.string().trim().email().max(254).transform(x=>x.toLowerCase())}).strict();
function parse<T>(schema:z.ZodType<T>,body:unknown):T{const result=schema.safeParse(body);if(!result.success)throw new BadRequestException('Données invalides.');return result.data;}
function originCheck(origin?:string){const c=getConfig();const allowed=[new URL(c.FRONTEND_ORIGIN).origin,new URL(c.PUBLIC_APP_URL||c.FRONTEND_ORIGIN).origin];if(!origin||!allowed.includes(origin))throw new ForbiddenException('Origine non autorisée.');}
const cookieOptions=()=>({httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax' as const,path:'/api/v1/alerts',maxAge:90*86400000});
@Controller('api/v1/alerts')
export class AlertsController {
 constructor(private readonly identity:SubscriberService,private readonly alerts:AlertsService,private readonly testPush:TestPushService){}
 @Get('config') config(){const c=getConfig();return {publicKey:c.VAPID_PUBLIC_KEY&&c.VAPID_PRIVATE_KEY&&c.VAPID_SUBJECT?c.VAPID_PUBLIC_KEY:null};}
 @Post('devices/:id/test') @HttpCode(200) async test(@Param('id') id:string,@Headers('cookie') cookie?:string,@Headers('origin') origin?:string){originCheck(origin);return this.testPush.send((await this.identity.current(cookie)).id,parse(z.string().uuid(),id));}
 @Post('login') @HttpCode(202) login(@Body() body:unknown,@Ip() ip:string,@Headers('origin') origin?:string){originCheck(origin);return this.identity.request(parse(login,body).email,ip);}
 @Post('verify') @HttpCode(200) async verify(@Body() body:unknown,@Res({passthrough:true}) res:Response,@Headers('origin') origin?:string){originCheck(origin);const {token}=parse(z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict(),body);const session=await this.identity.verify(token);res.cookie(SESSION_COOKIE,session,cookieOptions());return {ok:true};}
 @Get('me') async me(@Headers('cookie') cookie?:string){const sub=await this.identity.current(cookie);return {email:sub.email,rules:await this.alerts.list(sub.id),devices:await this.alerts.devices(sub.id)};}
 @Put('rules') async save(@Body() body:unknown,@Headers('cookie') cookie?:string,@Headers('origin') origin?:string){originCheck(origin);return this.alerts.save((await this.identity.current(cookie)).id,parse(ruleSchema,body));}
 @Post('disable-all') @HttpCode(200) async disableAll(@Headers('cookie') cookie?:string,@Headers('origin') origin?:string){originCheck(origin);return this.alerts.disableAll((await this.identity.current(cookie)).id);}
 @Post('devices') @HttpCode(200) async register(@Body() body:unknown,@Headers('cookie') cookie?:string,@Headers('origin') origin?:string,@Headers('user-agent') ua?:string){originCheck(origin);return this.alerts.register((await this.identity.current(cookie)).id,parse(pushSchema,body),ua);}
 @Post('devices/:id/revoke') @HttpCode(200) async revoke(@Param('id') id:string,@Headers('cookie') cookie?:string,@Headers('origin') origin?:string){originCheck(origin);return this.alerts.revoke((await this.identity.current(cookie)).id,parse(z.string().uuid(),id));}
 @Post('logout') @HttpCode(200) async logout(@Res({passthrough:true}) res:Response,@Headers('cookie') cookie?:string,@Headers('origin') origin?:string){originCheck(origin);await this.identity.logout(cookie);res.clearCookie(SESSION_COOKIE,cookieOptions());return {ok:true};}
}
@Module({controllers:[AlertsController],providers:[EmailService,SubscriberService,AlertsService,AlertProcessor,PushSender,TestPushService]})
export class AlertsModule{}
