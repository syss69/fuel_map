import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Ip, Module, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ADMIN_COOKIE, AdminAuthService, AdminGuard, AdminRateLimiter, checkOrigin } from './admin-auth.service';
import type { AdminRequest } from './admin-auth.service';
import { listSchema, renameSchema, reviewSchema, searchSchema, StationNamesService, suggestionSchema } from './station-names.service';

export function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException('Données invalides. Vérifiez les champs saisis.');
  return result.data;
}
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api/v1/admin' });
@Controller('api/v1/admin')
export class AdminLoginController {
  constructor(@Inject(AdminAuthService) private readonly auth: AdminAuthService) {}
  @Post('login') @HttpCode(200)
  async login(@Body() body: unknown, @Ip() ip: string, @Headers('origin') origin: string | undefined, @Res({ passthrough: true }) response: Response) {
    checkOrigin(origin);
    const data = parse(z.object({ username: z.string().min(1).max(120), password: z.string().min(1).max(256) }).strict(), body);
    const token = await this.auth.login(data.username, data.password, ip);
    response.setHeader('Cache-Control', 'no-store');
    response.cookie(ADMIN_COOKIE, token, { ...cookieOptions(), maxAge: 8 * 3600000 });
    return { ok: true };
  }
}
@Controller('api/v1/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(@Inject(AdminAuthService) private readonly auth: AdminAuthService, @Inject(StationNamesService) private readonly names: StationNamesService) {}
  @Get('session') session(@Req() req: AdminRequest, @Res({ passthrough: true }) res: Response) { res.setHeader('Cache-Control', 'no-store'); return req.admin; }
  @Post('logout') @HttpCode(200)
  async logout(@Headers('cookie') cookie: string | undefined, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(cookie); res.clearCookie(ADMIN_COOKIE, cookieOptions()); return { ok: true };
  }
  @Get('name-suggestions') suggestions(@Query() query: unknown) { const data = parse(listSchema, query); return this.names.suggestions(data.status, data.page); }
  @Put('name-suggestions/:id') review(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AdminRequest) { return this.names.review(id, parse(reviewSchema, body), req.admin.username); }
  @Get('stations') stations(@Query() query: unknown) { const data = parse(searchSchema, query); return this.names.stations(data.q, data.page); }
  @Get('stations/:id/history') history(@Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) {
    const data = parse(z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }).strict(), query);
    return this.names.history(id, data.page);
  }
  @Put('stations/:id/name') rename(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AdminRequest) { return this.names.rename(id, parse(renameSchema, body), req.admin.username); }
}
@Controller('api/v1/stations')
export class NameSuggestionsController {
  constructor(@Inject(StationNamesService) private readonly names: StationNamesService) {}
  @Post(':id/name-suggestions') suggest(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Ip() ip: string, @Headers('origin') origin?: string) {
    checkOrigin(origin); return this.names.suggest(id, parse(suggestionSchema, body), ip);
  }
}
@Module({ controllers: [AdminLoginController, AdminController, NameSuggestionsController], providers: [AdminAuthService, AdminRateLimiter, AdminGuard, StationNamesService] })
export class AdminModule {}
