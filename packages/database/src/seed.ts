import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { Pool } from 'pg';
import { FUEL_TYPES } from './domain';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv();

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: url });
  try {
    for (const fuel of FUEL_TYPES) {
      await pool.query(
        `INSERT INTO fuel_types (id, code, label, sort_order) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, label = EXCLUDED.label, sort_order = EXCLUDED.sort_order`,
        [fuel.id, fuel.code, fuel.label, fuel.sortOrder],
      );
    }
  } finally {
    await pool.end();
  }
  console.log('Six fuel types seeded.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
