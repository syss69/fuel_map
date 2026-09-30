import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getConfig } from './config';

async function bootstrap(): Promise<void> {
  const config = getConfig();
  const app = await NestFactory.create(AppModule);
  if (config.TRUST_PROXY_HOPS) app.getHttpAdapter().getInstance().set('trust proxy', config.TRUST_PROXY_HOPS);
  app.enableCors({ origin: config.FRONTEND_ORIGIN, credentials: true });
  app.enableShutdownHooks();
  await app.listen(config.API_PORT);
}

void bootstrap();
