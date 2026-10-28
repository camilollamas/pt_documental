import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { OnApplicationBootstrap } from '@nestjs/common';
import { Job } from 'bullmq';
import { appConfig } from '../common/config.js';
import { INDEXING_QUEUE, IndexingJob } from './indexing-queue.module.js';
import { IndexingService } from './indexing.service.js';

@Processor(INDEXING_QUEUE)
export class IndexingProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(private readonly indexing: IndexingService) {
    super();
  }

  // Se fija aquí y no en @Processor: el decorador se evalúa al importar, antes de cargar .env.
  onApplicationBootstrap() {
    this.worker.concurrency = appConfig().indexingConcurrency;
  }

  process(job: Job<IndexingJob>): Promise<void> {
    return this.indexing.index(job.data.documentId);
  }

  /** Agotados los reintentos de un fallo transitorio, el documento no puede quedar en PROCESANDO. */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<IndexingJob> | undefined) {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await this.indexing.markError(
        job.data.documentId,
        'Error interno al indexar; se agotaron los reintentos',
      );
    }
  }
}
