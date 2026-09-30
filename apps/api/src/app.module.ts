import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { StationsModule } from './stations/stations.module';
import { DigestModule } from './digest/digest.module';
import { AlertsModule } from './alerts/alerts.module';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, HealthModule, StationsModule, ImportsModule, DigestModule, AlertsModule],
})
export class AppModule {}
