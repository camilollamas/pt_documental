import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { IndexingService } from '../src/indexing/indexing.service.js';
import { WorkerModule } from '../src/indexing/worker.module.js';
import { createTestApp, loginAsAdmin, metadata, uploadRequest } from './helpers.js';

type SseEvent = { type: string; data: Record<string, unknown> };

/** Cliente SSE mínimo sobre fetch: lee el protocolo real (event:/data:, comentarios ":"). */
function openSse(url: string) {
  const controller = new AbortController();
  const events: SseEvent[] = [];
  const response = fetch(url, { signal: controller.signal, headers: { accept: 'text/event-stream' } });

  void response
    .then(async (res) => {
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let type = 'message';
          const data: string[] = [];
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) type = line.slice(6).trim();
            else if (line.startsWith('data:')) data.push(line.slice(5).trim());
          }
          if (data.length) events.push({ type, data: JSON.parse(data.join('\n')) });
        }
      }
    })
    .catch(() => undefined); // abort al cerrar

  async function waitFor(predicate: (e: SseEvent) => boolean, timeoutMs = 5_000): Promise<SseEvent> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = events.find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`Evento no recibido en ${timeoutMs} ms. Recibidos: ${JSON.stringify(events)}`);
  }

  return { events, response, waitFor, close: () => controller.abort() };
}

const isStatus = (id: string, status: string) => (e: SseEvent) =>
  e.type === 'status' && e.data.id === id && e.data.status === status;

describe('Notificaciones en tiempo real (SSE + Redis Pub/Sub)', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let db: DataSource;
  let storageDir: string;
  let baseUrl: string;
  const open: ReturnType<typeof openSse>[] = [];

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'docs-events-e2e-'));
    app = await createTestApp({ STORAGE_DIR: storageDir });
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    // Worker en un contenedor Nest aparte: sus eventos llegan a la API solo a través de Redis.
    // (Mismo aviso esperado de DataSourceNameRegistry que en indexing.e2e-spec.ts.)
    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    db = app.get(DataSource);
  });

  afterEach(() => open.splice(0).forEach((s) => s.close()));

  afterAll(async () => {
    await worker.close();
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(() => db.query('TRUNCATE documents'));

  const sse = (ids: string[] = []) => {
    const stream = openSse(`${baseUrl}/api/events${ids.length ? `?ids=${ids.join(',')}` : ''}`);
    open.push(stream);
    return stream;
  };

  /** Documento en PROCESANDO con su archivo, sin trabajo en cola: el test decide cuándo indexar. */
  async function pending(content: string | Buffer, mimeType = 'text/plain'): Promise<string> {
    const id = randomUUID();
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    await writeFile(join(storageDir, id), bytes);
    await db.query(
      `INSERT INTO documents (id, title, author, category, version, original_filename, mime_type,
                              storage_path, size_bytes)
       VALUES ($1, 'Doc', 'QA', 'Manual', '1', 'd', $2, $3, $4)`,
      [id, mimeType, id, bytes.length],
    );
    return id;
  }

  const index = (id: string) => worker.get(IndexingService).index(id);

  it('abre un flujo text/event-stream y confirma la suscripción', async () => {
    const stream = sse();
    const res = await stream.response;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    await stream.waitFor((e) => e.type === 'ready');
  });

  it('envía al conectar el estado actual de los documentos seguidos (snapshot)', async () => {
    const id = await pending('kubernetes');
    await index(id);

    const event = await sse([id]).waitFor(isStatus(id, 'INDEXADO'));
    expect(event.data).toMatchObject({ contentIndexed: true, errorMessage: null });
  });

  it('notifica en vivo el paso de PROCESANDO a INDEXADO, publicado por el worker', async () => {
    const id = await pending('helm charts');
    const stream = sse([id]);
    const snapshot = await stream.waitFor(isStatus(id, 'PROCESANDO'));

    await index(id);

    const live = await stream.waitFor(isStatus(id, 'INDEXADO'));
    expect(live.data.contentIndexed).toBe(true);
    // updatedAt permite al cliente quedarse siempre con el estado más reciente.
    expect(Date.parse(live.data.updatedAt as string)).toBeGreaterThan(
      Date.parse(snapshot.data.updatedAt as string),
    );
  });

  it('notifica en vivo el paso a ERROR con su causa', async () => {
    const id = await pending(Buffer.from('%PDF-1.4 dañado'), 'application/pdf');
    const stream = sse([id]);
    await stream.waitFor(isStatus(id, 'PROCESANDO'));

    await index(id);

    const event = await stream.waitFor(isStatus(id, 'ERROR'));
    expect(event.data.errorMessage).toBe('El PDF está dañado o no se puede leer');
  });

  it('solo envía los eventos de los documentos seguidos', async () => {
    const [followed, other] = [await pending('a'), await pending('b')];
    const stream = sse([followed]);
    await stream.waitFor(isStatus(followed, 'PROCESANDO'));

    await index(other);
    await index(followed);
    await stream.waitFor(isStatus(followed, 'INDEXADO'));

    expect(stream.events.some((e) => e.data.id === other)).toBe(false);
  });

  it('sin ids envía los cambios de cualquier documento', async () => {
    const id = await pending('c');
    const stream = sse();
    await stream.waitFor((e) => e.type === 'ready');

    await index(id);

    await stream.waitFor(isStatus(id, 'INDEXADO'));
  });

  it('recupera al reconectar un cambio ocurrido mientras estaba desconectado', async () => {
    const id = await pending('d');
    const first = sse([id]);
    await first.waitFor(isStatus(id, 'PROCESANDO'));
    first.close();

    // Este evento se publica sin nadie escuchando: Pub/Sub no lo guarda.
    await index(id);

    await sse([id]).waitFor(isStatus(id, 'INDEXADO'));
  });

  it('cubre el flujo real: carga GraphQL → worker → evento INDEXADO', async () => {
    const token = await loginAsAdmin(app);
    const res = await uploadRequest(
      app,
      [{ name: 'real.txt', content: Buffer.from('flujo completo con argo cd') }],
      { 'apollo-require-preflight': 'true', authorization: `Bearer ${token}` },
      [metadata('Real')],
    );
    const [{ id, status }] = res.body.data.uploadDocuments;
    expect(status).toBe('PROCESANDO');

    // El worker de la prueba consume la cola real; el estado llega por snapshot o en vivo.
    await sse([id]).waitFor(isStatus(id, 'INDEXADO'), 10_000);
  });

  it('valida los ids seguidos', async () => {
    expect((await fetch(`${baseUrl}/api/events?ids=no-es-uuid`)).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, () => randomUUID()).join(',');
    expect((await fetch(`${baseUrl}/api/events?ids=${tooMany}`)).status).toBe(400);
  });
});
