import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job } from 'bullmq';
import { appConfig } from '../common/config.js';
import { INDEXING_QUEUE, IndexingJob } from './indexing-queue.module.js';
import { IndexingService } from './indexing.service.js';

@Processor(INDEXING_QUEUE)
export class IndexingProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(IndexingProcessor.name);

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

  /**
   * Agotados los reintentos de un fallo transitorio, el documento no puede quedar en PROCESANDO.
   * Nunca lanza: es un manejador de eventos, y un rechazo sin capturar tumbaría el proceso worker.
   * Si marcar ERROR también falla (p. ej. la BD sigue caída), el documento queda en PROCESANDO y
   * lo recupera la reconciliación al reiniciar el worker (requeuePending).
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<IndexingJob> | undefined) {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    try {
      await this.indexing.markError(
        job.data.documentId,
        'Error interno al indexar; se agotaron los reintentos',
      );
    } catch (error) {
      this.logger.error(
        `No se pudo marcar ERROR en ${job.data.documentId}: ${(error as Error).message}`,
      );
    }
  }
}
