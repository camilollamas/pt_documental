import { Controller, MessageEvent, Query, Sse } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { filter, from, interval, map, merge, mergeMap, Observable } from 'rxjs';
import { In, Repository } from 'typeorm';
import { DocumentEntity } from '../documents/document.entity.js';
import { DocumentStatusEvent } from './document-status-event.js';
import { EventsQueryDto } from './events-query.dto.js';
import { StatusStream } from './status-stream.service.js';

const HEARTBEAT_MS = 25_000;
const RECONNECT_MS = 3_000;

@Controller('events')
export class EventsController {
  constructor(
    private readonly stream: StatusStream,
    @InjectRepository(DocumentEntity) private readonly documents: Repository<DocumentEntity>,
  ) {}

  /**
   * Notificaciones de estado sin polling (HU-04).
   *
   * Orden deliberado: `merge` se suscribe primero a los eventos en vivo y después lee el snapshot
   * de PostgreSQL. Así no hay hueco en el que un cambio se pierda; si snapshot y evento llegan
   * cruzados, el cliente conserva el de `updatedAt` más reciente. Pub/Sub no guarda mensajes:
   * en cada reconexión (automática en EventSource) el snapshot repone lo ocurrido mientras tanto.
   */
  @Sse()
  events(@Query() { ids }: EventsQueryDto): Observable<MessageEvent> {
    const followed = new Set(ids);

    const live$ = this.stream.changes$.pipe(
      filter((event) => followed.size === 0 || followed.has(event.id)),
      map(toMessage),
    );

    const snapshot$ = from(
      followed.size ? this.documents.findBy({ id: In([...followed]) }) : Promise.resolve([]),
    ).pipe(
      mergeMap((docs) => docs),
      map((doc) => toMessage(toEvent(doc))),
    );

    // Comentario SSE: EventSource lo ignora, pero mantiene viva la conexión a través de proxies.
    const heartbeat$ = interval(HEARTBEAT_MS).pipe(map(() => ({ comment: 'ping' }) as MessageEvent));

    const hello$ = from([{ type: 'ready', data: { following: [...followed] }, retry: RECONNECT_MS }]);

    return merge(live$, hello$, snapshot$, heartbeat$);
  }
}

function toEvent(doc: DocumentEntity): DocumentStatusEvent {
  return {
    id: doc.id,
    status: doc.status,
    contentIndexed: doc.contentIndexed,
    errorMessage: doc.errorMessage,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toMessage(event: DocumentStatusEvent): MessageEvent {
  return { type: 'status', data: event };
}
