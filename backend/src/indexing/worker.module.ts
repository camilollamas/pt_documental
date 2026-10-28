import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileStorage } from '../common/file-storage.js';
import { typeOrmOptions } from '../database/typeorm.config.js';
import { StatusPublisher } from '../events/status-publisher.service.js';
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
  providers: [IndexingService, IndexingProcessor, StatusPublisher, FileStorage],
})
export class WorkerModule {}
