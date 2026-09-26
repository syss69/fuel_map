import { Module } from '@nestjs/common';
import { StationsController } from './stations.controller';
import { StationsService } from './stations.service';
import { QueueService } from './queue.service';

@Module({ controllers: [StationsController], providers: [StationsService, QueueService] })
export class StationsModule {}
