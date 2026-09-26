import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { StationsService } from './stations.service';

@Controller('api/v1/stations')
export class StationsController {
  constructor(private readonly stations: StationsService) {}

  @Get()
  list() {
    return this.stations.list();
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.stations.detail(id);
  }
}
