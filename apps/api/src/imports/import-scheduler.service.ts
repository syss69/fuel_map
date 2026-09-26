import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { getConfig } from '../config';
import { FuelImportService } from './fuel-import.service';

@Injectable()
export class ImportSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ImportSchedulerService.name);

  constructor(private readonly importer: FuelImportService) {}

  onApplicationBootstrap(): void {
    if (process.env.SKIP_INITIAL_IMPORT === 'true') return;
    setImmediate(() => {
      void this.importer.runImport('initial').catch((error: unknown) => {
        this.logger.error(error instanceof Error ? error.message : String(error));
      });
    });
  }

  @Cron(getConfig().FUEL_IMPORT_CRON)
  async scheduledImport(): Promise<void> {
    try {
      await this.importer.runImport('scheduled');
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
    }
  }
}
