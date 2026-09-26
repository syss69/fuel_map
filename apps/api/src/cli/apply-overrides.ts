import { config as loadEnv } from 'dotenv';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { z } from 'zod';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv();

const schema = z.record(
  z.object({ displayName: z.string().min(1).nullable().optional(), brand: z.string().min(1).nullable().optional() }),
);

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const file = path.resolve(process.cwd(), '../../data/station-overrides.json');
  const overrides = schema.parse(JSON.parse(await readFile(file, 'utf8')) as unknown);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let updated = 0;
  try {
    for (const [officialId, value] of Object.entries(overrides)) {
      const result = await pool.query(
        `UPDATE stations SET display_name = $2, brand = $3, updated_at = now() WHERE official_id = $1`,
        [officialId, value.displayName ?? null, value.brand ?? null],
      );
      updated += result.rowCount ?? 0;
    }
  } finally {
    await pool.end();
  }
  console.log(`Applied overrides to ${updated} station(s).`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
