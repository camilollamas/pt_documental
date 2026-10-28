import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { appConfig } from '../common/config.js';
import { redisOptions } from '../common/redis.js';
import { DocumentStatusEvent } from './document-status-event.js';

/** Lado worker: publica cada cambio de estado en Redis Pub/Sub. */
@Injectable()
export class StatusPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(StatusPublisher.name);
  private readonly redis = new Redis({ ...redisOptions(appConfig().redisUrl), lazyConnect: true });

  /**
   * Nunca lanza: PostgreSQL ya tiene el estado correcto. Un evento perdido se recupera
   * con el snapshot que el cliente recibe al (re)conectarse.
   */
  async publish(event: DocumentStatusEvent): Promise<void> {
    try {
      await this.redis.publish(appConfig().eventsChannel, JSON.stringify(event));
    } catch (error) {
      this.logger.error(`No se pudo publicar el estado de ${event.id}: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}
