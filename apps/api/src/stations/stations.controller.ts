import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { QueueService } from './queue.service';
import { StationsService } from './stations.service';
import { CommunityService, confirmationSchema, fuelReportsSchema } from './community.service';

@Controller('api/v1/stations')
export class StationsController {
  constructor(private readonly stations: StationsService, private readonly queues: QueueService, private readonly community: CommunityService) {}

  @Put(':id/confirmation')
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = confirmationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Confirmation invalide');
    return this.community.confirm(id, parsed.data.reporterId);
  }

  @Put(':id/fuel-reports')
  fuelReports(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = fuelReportsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Proposition invalide : vérifiez les carburants, disponibilités et prix.');
    return this.community.report(id, parsed.data.reporterId, parsed.data.fuels);
  }

  @Get()
  list() {
    return this.stations.list();
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string, @Query('reporterId') reporterId?: string) {
    if (reporterId !== undefined && !z.string().uuid().safeParse(reporterId).success) {
      throw new BadRequestException('reporterId invalide');
    }
    return this.stations.detail(id, reporterId);
  }

  @Put(':id/queue-report')
  report(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = z.object({
      reporterId: z.string().uuid(),
      status: z.enum(['NONE', 'LT_5', 'FROM_5_TO_10', 'FROM_11_TO_15', 'GT_15']),
    }).strict().safeParse(body);
    if (!parsed.success) throw new BadRequestException('Signalement invalide');
    return this.queues.report(id, parsed.data.reporterId, parsed.data.status);
  }
}
