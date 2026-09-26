import { Module } from '@nestjs/common';
import { FuelImportService } from './fuel-import.service';
import { ImportSchedulerService } from './import-scheduler.service';
import { OpenDataStationMapper } from './mappers/open-data-station.mapper';
import { FUEL_DATA_PROVIDER } from './providers/fuel-data.provider';
import { OpenDataFuelProvider } from './providers/open-data-fuel.provider';

@Module({
  providers: [
    FuelImportService,
    ImportSchedulerService,
    OpenDataStationMapper,
    { provide: FUEL_DATA_PROVIDER, useClass: OpenDataFuelProvider },
  ],
  exports: [FuelImportService],
})
export class ImportsModule {}
