import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getConfig } from './config';

async function bootstrap(): Promise<void> {
  const config = getConfig();
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: config.FRONTEND_ORIGIN });
  app.enableShutdownHooks();
  await app.listen(config.API_PORT);
}

void bootstrap();
