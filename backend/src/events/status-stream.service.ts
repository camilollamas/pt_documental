import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Observable, Subject } from 'rxjs';
import { appConfig } from '../common/config.js';
import { DocumentStatusEvent } from './document-status-event.js';

/**
 * Lado API: una sola suscripción a Redis por instancia, repartida a todos los clientes SSE.
 * Con varias instancias de la API cada una se suscribe y recibe el evento publicado por el worker.
 */
@Injectable()
export class StatusStream implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatusStream.name);
  private readonly subject = new Subject<DocumentStatusEvent>();
  // Una conexión en modo suscriptor no admite otros comandos: es exclusiva para Pub/Sub.
  private readonly subscriber = new Redis(appConfig().redisUrl, { lazyConnect: true });

  readonly changes$: Observable<DocumentStatusEvent> = this.subject.asObservable();

  async onModuleInit() {
    this.subscriber.on('message', (_channel, message) => {
      try {
        this.subject.next(JSON.parse(message) as DocumentStatusEvent);
      } catch {
        this.logger.warn('Evento de estado con formato inválido descartado');
      }
    });
    await this.subscriber.subscribe(appConfig().eventsChannel);
  }

  async onModuleDestroy() {
    this.subject.complete();
    await this.subscriber.quit().catch(() => undefined);
  }
}
