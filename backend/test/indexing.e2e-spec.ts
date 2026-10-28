import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { INDEXING_QUEUE } from '../src/indexing/indexing-queue.module.js';
import { IndexingService } from '../src/indexing/indexing.service.js';
import { WorkerModule } from '../src/indexing/worker.module.js';
import { createTestApp, loginAsAdmin, metadata, TestFile, uploadRequest } from './helpers.js';
import { makePdf } from './pdf-fixture.js';

type Row = {
  status: string;
  error_message: string | null;
  indexed_at: Date | null;
  content_indexed: boolean;
};

describe('Indexación en segundo plano (cola + worker)', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let db: DataSource;
  let storageDir: string;
  let headers: Record<string, string>;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'docs-indexing-e2e-'));
    app = await createTestApp({ STORAGE_DIR: storageDir });
    // El worker real, como proceso aparte en producción; aquí comparte proceso con la API.
    // Esperado: @nestjs/typeorm avisa "data source with the default name is already registered"
    // porque su registro de nombres es estático por proceso. Son dos contenedores Nest con
    // conexiones independientes, así que no se pisan; en producción el aviso no aparece.
    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    db = app.get(DataSource);
    headers = {
      'apollo-require-preflight': 'true',
      authorization: `Bearer ${await loginAsAdmin(app)}`,
    };
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(() => db.query('TRUNCATE documents'));

  async function upload(files: TestFile[], titles = files.map((f) => f.name)): Promise<string[]> {
    const res = await uploadRequest(app, files, headers, titles.map(metadata));
    return res.body.data.uploadDocuments.map((r: { id: string }) => r.id);
  }

  /** Solo las pruebas consultan en bucle; la interfaz recibirá el cambio por SSE. */
  async function waitForFinalStatus(id: string, timeoutMs = 10_000): Promise<Row> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [row] = await db.query<Row[]>(
        'SELECT status, error_message, indexed_at, content_indexed FROM documents WHERE id = $1',
        [id],
      );
      if (row && row.status !== 'PROCESANDO') return row;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`El documento ${id} sigue en PROCESANDO tras ${timeoutMs} ms`);
  }

  const matches = async (id: string, tsquery: string) => {
    const [row] = await db.query(
      `SELECT search_vector @@ to_tsquery('simple', $2) AS hit FROM documents WHERE id = $1`,
      [id, tsquery],
    );
    return row.hit as boolean;
  };

  it('indexa TXT, MD y PDF con pesos: título A, metadatos B, contenido C', async () => {
    const ids = await upload(
      [
        { name: 'proxy.txt', content: Buffer.from('Configurar nginx como proxy inverso') },
        { name: 'eventos.md', content: Buffer.from('# Eventos\n\nEl servicio publica en **kafka**') },
        { name: 'k8s.pdf', content: makePdf(['Despliegue con helm charts']) },
      ],
      ['Guía de despliegue', 'Arquitectura de eventos', 'Manual de Kubernetes'],
    );

    for (const id of ids) {
      const row = await waitForFinalStatus(id);
      expect(row).toMatchObject({ status: 'INDEXADO', error_message: null, content_indexed: true });
      expect(row.indexed_at).not.toBeNull();
    }
    const [txt, md, pdf] = ids;

    // Contenido real de cada formato, con peso C.
    expect(await matches(txt, 'nginx:C')).toBe(true);
    expect(await matches(md, 'kafka:C')).toBe(true);
    expect(await matches(pdf, 'helm:C')).toBe(true);
    // Título con peso A y etiqueta (metadato) con peso B.
    expect(await matches(txt, 'despliegue:A')).toBe(true);
    expect(await matches(pdf, 'kubernetes:A')).toBe(true);
    expect(await matches(md, 'pruebas:B')).toBe(true);
    // Un término del contenido no aparece con peso de título.
    expect(await matches(txt, 'nginx:A')).toBe(false);
  });

  it('indexa solo por metadatos, y lo marca, un PDF sin capa de texto (sin OCR)', async () => {
    const [id] = await upload([{ name: 'escaneado.pdf', content: makePdf([]) }], ['Plano eléctrico']);

    expect(await waitForFinalStatus(id)).toMatchObject({
      status: 'INDEXADO',
      content_indexed: false,
      error_message: null,
    });
    // Se encuentra por título y metadatos, aunque no haya contenido.
    expect(await matches(id, 'eléctrico:A')).toBe(true);
    expect(await matches(id, 'pruebas:B')).toBe(true);
  });

  it('trata igual un archivo de texto en blanco', async () => {
    const [id] = await upload([{ name: 'vacio.txt', content: Buffer.from('   \n  ') }]);
    expect(await waitForFinalStatus(id)).toMatchObject({
      status: 'INDEXADO',
      content_indexed: false,
    });
  });

  it('marca ERROR un documento que supera el tamaño máximo de un tsvector (1 MB)', async () => {
    // ~250k palabras distintas (≈8 MB): cabe en el límite de carga pero no en un tsvector.
    const words = Array.from({ length: 250_000 }, (_, i) => `t${i.toString(36)}x`).join(' ');
    const [id] = await upload([{ name: 'enorme.txt', content: Buffer.from(words) }]);
    expect(await waitForFinalStatus(id, 30_000)).toMatchObject({
      status: 'ERROR',
      error_message: 'El documento tiene demasiado texto para indexarse',
    });
  }, 40_000);

  it('marca ERROR un PDF dañado y el worker sigue procesando el siguiente documento', async () => {
    // Empieza por %PDF-, así que supera la validación de la carga; falla al extraer.
    const corrupt = { name: 'danado.pdf', content: Buffer.from('%PDF-1.4 contenido sin estructura') };
    const valid = { name: 'valido.txt', content: Buffer.from('guía de ansible para despliegues') };
    const [corruptId, validId] = await upload([corrupt, valid]);

    expect(await waitForFinalStatus(corruptId)).toMatchObject({
      status: 'ERROR',
      error_message: 'El PDF está dañado o no se puede leer',
      content_indexed: false,
    });
    // El fallo de un documento no detiene al worker: el siguiente se indexa con normalidad.
    expect(await waitForFinalStatus(validId)).toMatchObject({
      status: 'INDEXADO',
      content_indexed: true,
    });
    expect(await matches(validId, 'ansible:C')).toBe(true);
  });

  it('es idempotente: reprocesar un documento ya indexado no lo modifica', async () => {
    const [id] = await upload([{ name: 'a.txt', content: Buffer.from('texto de prueba') }]);
    const before = await waitForFinalStatus(id);

    await worker.get(IndexingService).index(id);

    const [after] = await db.query<Row[]>(
      'SELECT status, error_message, indexed_at, content_indexed FROM documents WHERE id = $1',
      [id],
    );
    expect(after).toEqual(before);
  });

  it('la reconciliación recupera un documento aunque su trabajo anterior siga retenido en la cola', async () => {
    // Un trabajo con el mismo id terminado y RETENIDO (removeOnComplete/removeOnFail) hace que
    // BullMQ ignore un add() nuevo con ese jobId. Se simula: el trabajo corre antes de que exista la fila.
    const id = randomUUID();
    const queue = worker.get<Queue>(getQueueToken(INDEXING_QUEUE));
    const stale = await queue.add('index', { documentId: id }, { jobId: id });
    const deadline = Date.now() + 10_000;
    while ((await stale.getState()) !== 'completed' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(await stale.getState()).toBe('completed');

    await writeFile(join(storageDir, id), 'documento con un trabajo viejo retenido sobre vault');
    await db.query(
      `INSERT INTO documents (id, title, author, category, version, original_filename, mime_type,
                              storage_path, size_bytes)
       VALUES ($1, 'Retenido', 'QA', 'Manual', '1', 'r.txt', 'text/plain', $2, 50)`,
      [id, id],
    );

    expect(await worker.get(IndexingService).requeuePending()).toBe(1);
    expect((await waitForFinalStatus(id)).status).toBe('INDEXADO');
    expect(await matches(id, 'vault:C')).toBe(true);
  }, 30_000);

  it('reencola documentos que quedaron en PROCESANDO sin trabajo (reconciliación)', async () => {
    // Simula una carga cuyo encolado falló: fila y archivo existen, pero no hay trabajo en Redis.
    const id = randomUUID();
    await writeFile(join(storageDir, id), 'documento huérfano sobre terraform');
    await db.query(
      `INSERT INTO documents (id, title, author, category, version, original_filename, mime_type,
                              storage_path, size_bytes)
       VALUES ($1, 'Huérfano', 'QA', 'Manual', '1', 'h.txt', 'text/plain', $2, 33)`,
      [id, id],
    );

    expect(await worker.get(IndexingService).requeuePending()).toBe(1);
    expect((await waitForFinalStatus(id)).status).toBe('INDEXADO');
    expect(await matches(id, 'terraform:C')).toBe(true);
  });
});
