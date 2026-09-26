import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { getConfig } from '../config';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly pool = new Pool({ connectionString: getConfig().DATABASE_URL });

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
