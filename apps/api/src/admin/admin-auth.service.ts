import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { DatabaseService } from '../database/database.service';
import { getConfig } from '../config';
import { verifyPassword } from './password';

export const ADMIN_COOKIE = 'trajetico_admin';
export interface AdminIdentity { username: string; role: 'ADMIN' }
export type AdminRequest = Request & { admin: AdminIdentity };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function checkOrigin(origin?: string) {
  const config = getConfig();
  if (!origin || ![config.FRONTEND_ORIGIN, config.PUBLIC_APP_URL].filter(Boolean).some(url => new URL(url!).origin === origin)) {
    throw new ForbiddenException('Origine non autorisée.');
  }
}

@Injectable()
export class AdminRateLimiter {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async consume(scope: string, value: string, limit: number, seconds: number) {
    const { rows } = await this.db.pool.query(
      `INSERT INTO admin_rate_limits(key,attempts,expires_at) VALUES($1,1,clock_timestamp()+$2*interval '1 second')
       ON CONFLICT(key) DO UPDATE SET
         attempts=CASE WHEN admin_rate_limits.expires_at<=clock_timestamp() THEN 1 ELSE admin_rate_limits.attempts+1 END,
         expires_at=CASE WHEN admin_rate_limits.expires_at<=clock_timestamp() THEN clock_timestamp()+$2*interval '1 second' ELSE admin_rate_limits.expires_at END
       RETURNING attempts`, [hash(`${scope}:${value}`), seconds]);
    if (rows[0].attempts > limit) throw new HttpException('Trop de demandes. Veuillez réessayer plus tard.', 429);
  }
}

@Injectable()
export class AdminAuthService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService, @Inject(AdminRateLimiter) private readonly limits: AdminRateLimiter) {}
  private credentials() {
    const { ADMIN_USERNAME: username, ADMIN_PASSWORD_HASH: password } = getConfig();
    if (!username || !password) throw new UnauthorizedException('Connexion administrateur indisponible.');
    return { username, password, version: hash(JSON.stringify([username, password])) };
  }
  async login(username: string, password: string, ip: string) {
    const credentials = this.credentials();
    await this.limits.consume('admin-login', ip, 5, 900);
    // Always run the password check, including for an unknown username.
    const valid = await verifyPassword(password, credentials.password);
    if (!valid || username !== credentials.username) throw new UnauthorizedException('Identifiants incorrects.');
    const token = randomBytes(32).toString('base64url');
    await this.db.pool.query(`INSERT INTO admin_sessions(token_hash,username,credential_version,expires_at)
      VALUES($1,$2,$3,now()+interval '8 hours')`, [hash(token), username, credentials.version]);
    return token;
  }
  private token(cookie?: string) {
    const token = cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1);
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  }
  async current(cookie?: string): Promise<AdminIdentity> {
    const credentials = this.credentials();
    const token = this.token(cookie);
    if (!token) throw new UnauthorizedException('Veuillez vous connecter.');
    const result = await this.db.pool.query(`SELECT username FROM admin_sessions WHERE token_hash=$1
      AND credential_version=$2 AND username=$3 AND expires_at>now()`, [hash(token), credentials.version, credentials.username]);
    if (!result.rowCount) throw new UnauthorizedException('Session expirée. Veuillez vous reconnecter.');
    return { username: credentials.username, role: 'ADMIN' };
  }
  async logout(cookie?: string) {
    const token = this.token(cookie);
    if (token) await this.db.pool.query('DELETE FROM admin_sessions WHERE token_hash=$1', [hash(token)]);
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(AdminAuthService) private readonly auth: AdminAuthService) {}
  async canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    const request = context.switchToHttp().getRequest<AdminRequest>();
    request.admin = await this.auth.current(request.headers.cookie);
    if (!['GET', 'HEAD'].includes(request.method)) checkOrigin(request.headers.origin);
    return true;
  }
}
