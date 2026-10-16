import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, options, (error, key) => error ? reject(error) : resolve(key)));
}
export const passwordHashPattern = /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/;
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (!passwordHashPattern.test(encoded)) return false;
  const [, salt, hash] = encoded.split('$');
  return timingSafeEqual(await derive(password, Buffer.from(salt, 'hex')), Buffer.from(hash, 'hex'));
}
