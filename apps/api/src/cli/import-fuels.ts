import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

process.env.SKIP_INITIAL_IMPORT = 'true';

async function main(): Promise<void> {
  const [{ AppModule }, { FuelImportService }] = await Promise.all([
    import('../app.module'),
    import('../imports/fuel-import.service'),
  ]);
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    await app.get(FuelImportService).runImport('manual');
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
