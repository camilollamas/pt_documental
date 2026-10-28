import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { appConfig } from '../common/config.js';

export const INDEXING_QUEUE = 'indexing';

export type IndexingJob = { documentId: string };

/** Conexión a Redis y cola de indexación. La usan la API (encola) y el worker (consume). */
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => {
        const url = new URL(appConfig().redisUrl);
        // Opciones (no una instancia de ioredis): así BullMQ crea y cierra sus propias conexiones.
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            db: Number(url.pathname.slice(1) || 0),
            password: url.password || undefined,
          },
        };
      },
    }),
    BullModule.registerQueue({
      name: INDEXING_QUEUE,
      defaultJobOptions: {
        // Solo los fallos transitorios llegan a reintentarse (los definitivos se marcan ERROR sin lanzar).
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 1_000,
        removeOnFail: 1_000,
      },
    }),
  ],
  exports: [BullModule],
})
export class IndexingQueueModule {}
