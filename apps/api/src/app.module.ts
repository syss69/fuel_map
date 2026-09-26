import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { StationsModule } from './stations/stations.module';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, HealthModule, StationsModule, ImportsModule],
})
export class AppModule {}
