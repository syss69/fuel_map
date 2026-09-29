import { Module } from '@nestjs/common';
import { StationsController } from './stations.controller';
import { StationsService } from './stations.service';
import { QueueService } from './queue.service';
import { CommunityService } from './community.service';

@Module({ controllers: [StationsController], providers: [StationsService, QueueService, CommunityService] })
export class StationsModule {}
