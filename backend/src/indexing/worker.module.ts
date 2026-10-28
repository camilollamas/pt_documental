import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmOptions } from '../database/typeorm.config.js';
import { IndexingQueueModule } from './indexing-queue.module.js';
import { IndexingProcessor } from './indexing.processor.js';
import { IndexingService } from './indexing.service.js';

/** Contexto del proceso worker: sin HTTP ni GraphQL, solo BD + cola. */
@Module({
  imports: [
    // El worker no migra: lo hace la API al arrancar.
    TypeOrmModule.forRootAsync({ useFactory: () => ({ ...typeOrmOptions(), migrationsRun: false }) }),
    IndexingQueueModule,
  ],
  providers: [IndexingService, IndexingProcessor],
})
export class WorkerModule {}
