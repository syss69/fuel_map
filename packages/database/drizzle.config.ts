import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import path from 'node:path';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv();

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL },
});
