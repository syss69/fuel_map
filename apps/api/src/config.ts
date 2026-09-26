import { z } from 'zod';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv();

const schema = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(3000),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  FUEL_DATASET_DEPARTMENT: z.string().min(1).default('64'),
  FUEL_IMPORT_CRON: z.string().min(1).default('*/15 * * * *'),
  FUEL_API_BASE_URL: z.string().url().default('https://data.economie.gouv.fr'),
});

export type AppConfig = z.infer<typeof schema>;
let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= schema.parse(process.env);
  return cached;
}
