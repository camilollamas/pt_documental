import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { IndexingService } from '../src/indexing/indexing.service.js';
import { WorkerModule } from '../src/indexing/worker.module.js';
import { createTestApp } from './helpers.js';
import { makePdf } from './pdf-fixture.js';

type Seed = {
  title: string;
  content: string | Buffer;
  mimeType?: string;
  filename?: string;
  author?: string;
  tags?: string[];
};

type Segment = { text: string; match: boolean };

describe('Búsqueda, detalle y original', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let db: DataSource;
  let storageDir: string;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'docs-search-e2e-'));
    app = await createTestApp({ STORAGE_DIR: storageDir });
    // Mismo aviso esperado de DataSourceNameRegistry que en indexing.e2e-spec.ts.
    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(() => db.query('TRUNCATE documents'));

  /** Inserta el documento y lo indexa con el código real del worker. */
  async function seed(doc: Seed): Promise<string> {
    const id = randomUUID();
    const content = Buffer.isBuffer(doc.content) ? doc.content : Buffer.from(doc.content);
    await writeFile(join(storageDir, id), content);
    await db.query(
      `INSERT INTO documents (id, title, author, category, tags, version, original_filename,
                              mime_type, storage_path, size_bytes)
       VALUES ($1, $2, $3, 'Manual', $4, '1.0', $5, $6, $7, $8)`,
      [
        id,
        doc.title,
        doc.author ?? 'Equipo',
        doc.tags ?? [],
        doc.filename ?? 'doc.txt',
        doc.mimeType ?? 'text/plain',
        id,
        content.length,
      ],
    );
    await worker.get(IndexingService).index(id);
    return id;
  }

  const http = () => request(app.getHttpServer());
  const search = (query: string, extra: Record<string, unknown> = {}) =>
    http().get('/api/documents').query({ query, ...extra });
  const ids = (res: request.Response) => res.body.items.map((i: { id: string }) => i.id);
  const matched = (segments: Segment[]) => segments.filter((s) => s.match).map((s) => s.text);

  describe('búsqueda full-text', () => {
    it('encuentra por título, autor, etiqueta y contenido de TXT, MD y PDF', async () => {
      const txt = await seed({ title: 'Guía de redes', content: 'configurar nginx como proxy' });
      const md = await seed({
        title: 'Eventos',
        content: '# Bus\n\nUsamos **kafka**',
        mimeType: 'text/markdown',
        author: 'Lucía Pérez',
      });
      const pdf = await seed({
        title: 'Operaciones',
        content: makePdf(['Despliegue con helm charts']),
        mimeType: 'application/pdf',
        tags: ['kubernetes'],
      });

      expect(ids(await search('redes').expect(200))).toEqual([txt]);
      expect(ids(await search('nginx'))).toEqual([txt]);
      expect(ids(await search('kafka'))).toEqual([md]);
      expect(ids(await search('lucía'))).toEqual([md]);
      expect(ids(await search('helm'))).toEqual([pdf]);
      expect(ids(await search('kubernetes'))).toEqual([pdf]);
    });

    it('ordena por relevancia: una coincidencia en el título pesa más que en el contenido', async () => {
      const inContent = await seed({ title: 'Manual general', content: 'sección sobre terraform' });
      const inTitle = await seed({ title: 'Terraform avanzado', content: 'módulos y estado remoto' });

      const res = await search('terraform');
      expect(ids(res)).toEqual([inTitle, inContent]);
      expect(res.body.items[0].rank).toBeGreaterThan(res.body.items[1].rank);
    });

    it('distingue frase exacta, OR y exclusión (sintaxis websearch)', async () => {
      const phrase = await seed({ title: 'A', content: 'instalación del servidor de correo' });
      const scattered = await seed({ title: 'B', content: 'servidor nuevo; la instalación terminó' });
      const other = await seed({ title: 'C', content: 'monitoreo con grafana' });

      expect(ids(await search('"instalación del servidor"'))).toEqual([phrase]);
      expect(ids(await search('instalación servidor')).sort()).toEqual([phrase, scattered].sort());
      expect(ids(await search('servidor -correo'))).toEqual([scattered]);
      expect(ids(await search('grafana or correo')).sort()).toEqual([phrase, other].sort());
    });

    it('resalta las coincidencias como segmentos de texto, sin HTML', async () => {
      // ts_headline NO escapa HTML: devuelve <img … onerror=…> tal cual (comprobado en psql).
      // Por eso la API entrega segmentos de texto y nunca marcado listo para innerHTML.
      await seed({
        title: 'Seguridad de kafka',
        content: 'el clúster de kafka <img src=x onerror=alert(1)> usa TLS',
      });
      const [item] = (await search('kafka')).body.items;

      expect(matched(item.titleHighlight)).toEqual(['kafka']);
      expect(matched(item.snippets.flat())).toEqual(['kafka']);
      // El fragmento puede incluso cortar la etiqueta a la mitad: llega como texto plano.
      const plain = item.snippets.flat().filter((s: Segment) => !s.match);
      expect(plain.map((s: Segment) => s.text).join('')).toContain('<img src=x onerror=alert');
      expect(JSON.stringify(item)).not.toMatch(/<\/?(b|mark)>/);
    });

    it('pagina de forma estable y sin solapes', async () => {
      for (let i = 0; i < 25; i++) await seed({ title: `Runbook ${i}`, content: 'procedimiento de guardia' });

      const pages = await Promise.all([1, 2, 3].map((page) => search('guardia', { page, pageSize: 10 })));
      expect(pages.map((p) => p.body.items.length)).toEqual([10, 10, 5]);
      expect(pages.every((p) => p.body.total === 25)).toBe(true);
      expect(new Set(pages.flatMap(ids)).size).toBe(25);
      // Misma consulta, mismo orden.
      expect(ids(await search('guardia', { page: 2, pageSize: 10 }))).toEqual(ids(pages[1]));
      // Página fuera de rango: vacía pero con el total real.
      const beyond = await search('guardia', { page: 9, pageSize: 10 });
      expect(beyond.body).toMatchObject({ items: [], total: 25, page: 9 });
    });

    it('limita el conteo con un tope y lo indica (totalCapped), sin cambiar los resultados', async () => {
      for (let i = 0; i < 25; i++) await seed({ title: `Nota ${i}`, content: 'alarma de disco' });
      try {
        process.env.SEARCH_COUNT_CAP = '20';
        const capped = await search('alarma', { pageSize: 10 });
        expect(capped.body).toMatchObject({ total: 20, totalCapped: true });
        expect(capped.body.items).toHaveLength(10);

        process.env.SEARCH_COUNT_CAP = '100';
        expect((await search('alarma')).body).toMatchObject({ total: 25, totalCapped: false });
      } finally {
        delete process.env.SEARCH_COUNT_CAP;
      }
    });

    it('responde vacío, sin error, a búsquedas vacías, sin resultados o solo con signos', async () => {
      await seed({ title: 'Algo', content: 'texto' });
      for (const query of ['', '   ', 'inexistentexyz', '!!! ???', '&|:*']) {
        const res = await search(query).expect(200);
        expect(res.body).toMatchObject({ items: [], total: 0 });
      }
    });

    it('trata la inyección SQL como texto a buscar', async () => {
      await seed({ title: 'Tabla de usuarios', content: 'drop de tablas temporales' });
      await search("'; DROP TABLE documents; --").expect(200);
      expect(await db.query('SELECT count(*)::int AS n FROM documents')).toEqual([{ n: 1 }]);
    });

    it('no devuelve documentos en PROCESANDO ni en ERROR', async () => {
      await seed({ title: 'Indexado sobre ansible', content: 'ansible' });
      await db.query(
        `INSERT INTO documents (title, author, category, version, original_filename, mime_type,
                                storage_path, size_bytes, status, error_message)
         VALUES ('Pendiente ansible', 'a', 'c', '1', 'p.txt', 'text/plain', 'x', 1, 'PROCESANDO', NULL),
                ('Fallido ansible', 'a', 'c', '1', 'f.pdf', 'application/pdf', 'y', 1, 'ERROR', 'dañado')`,
      );
      const res = await search('ansible');
      expect(res.body.items.map((i: { title: string }) => i.title)).toEqual([
        'Indexado sobre ansible',
      ]);
    });

    it('incluye los documentos sin contenido indexado, marcados y sin fragmentos', async () => {
      await seed({ title: 'Plano escaneado', content: makePdf([]), mimeType: 'application/pdf' });
      const [item] = (await search('plano')).body.items;
      expect(item).toMatchObject({ contentIndexed: false, snippets: [] });
    });

    it('valida los parámetros', async () => {
      await search('x', { pageSize: 51 }).expect(400);
      await search('x', { page: 0 }).expect(400);
      await search('x', { page: 'uno' }).expect(400);
      await search('x'.repeat(201)).expect(400);
    });

    it('expone el tiempo de base de datos en Server-Timing', async () => {
      const res = await search('cualquiera');
      expect(res.headers['server-timing']).toMatch(/^db;dur=\d+(\.\d+)?$/);
    });

    it('no usa LIKE ni ILIKE en el código de búsqueda', async () => {
      // Se ignoran los comentarios de TypeScript (que sí mencionan LIKE para explicar por qué no se usa).
      const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const dir of ['src/search', 'src/documents']) {
        for (const file of await readdir(dir, { recursive: true })) {
          if (!file.endsWith('.ts')) continue;
          const source = stripComments(await readFile(join(dir, file), 'utf8'));
          expect(source, `${dir}/${file}`).not.toMatch(/\bI?LIKE\b/i);
        }
      }
    });
  });

  describe('detalle y estado', () => {
    it('devuelve metadatos y estado, sin exponer la ruta física', async () => {
      const id = await seed({ title: 'Detalle', content: 'contenido', tags: ['a', 'b'] });
      const res = await http().get(`/api/documents/${id}`).expect(200);

      expect(res.body).toMatchObject({
        id,
        title: 'Detalle',
        tags: ['a', 'b'],
        mimeType: 'text/plain',
        status: 'INDEXADO',
        contentIndexed: true,
        errorMessage: null,
      });
      expect(res.body).not.toHaveProperty('storagePath');
      expect(res.body).not.toHaveProperty('extractedText');
    });

    it('expone el estado actual', async () => {
      const id = await seed({ title: 'Estado', content: 'x' });
      const res = await http().get(`/api/documents/${id}/status`).expect(200);
      expect(res.body).toMatchObject({ id, status: 'INDEXADO', contentIndexed: true });
    });

    it('responde 404 a un id inexistente y 400 a un id inválido', async () => {
      await http().get(`/api/documents/${randomUUID()}`).expect(404);
      await http().get('/api/documents/no-es-uuid').expect(400);
      await http().get(`/api/documents/${randomUUID()}/original`).expect(404);
    });
  });

  describe('archivo original', () => {
    it('sirve el PDF original embebible (inline) y con su tipo real', async () => {
      const pdf = makePdf(['Original']);
      const id = await seed({
        title: 'PDF',
        content: pdf,
        mimeType: 'application/pdf',
        filename: 'Guía técnica.pdf',
      });

      const res = await http().get(`/api/documents/${id}/original`).buffer(true).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        `inline; filename="Gu_a t_cnica.pdf"; filename*=UTF-8''Gu%C3%ADa%20t%C3%A9cnica.pdf`,
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(res.body, pdf)).toBe(0);
    });

    it('permite descargarlo explícitamente con ?download=1 (escapa comilla y paréntesis en filename*)', async () => {
      const id = await seed({ title: 'T', content: 'hola', filename: "O'Brien (v2).txt" });
      const res = await http().get(`/api/documents/${id}/original?download=1`).expect(200);
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="O'Brien (v2).txt"; filename*=UTF-8''O%27Brien%20%28v2%29.txt`,
      );
    });

    it('sirve TXT y MD como texto UTF-8', async () => {
      const id = await seed({
        title: 'MD',
        content: '# Título\n\nñandú',
        mimeType: 'text/markdown',
        filename: 'readme.md',
      });
      const res = await http().get(`/api/documents/${id}/original`).expect(200);
      expect(res.headers['content-type']).toBe('text/markdown; charset=utf-8');
      expect(res.text).toBe('# Título\n\nñandú');
    });

    it('admite peticiones parciales (Range), necesarias para visores como PDF.js', async () => {
      const id = await seed({ title: 'R', content: '0123456789' });
      const res = await http().get(`/api/documents/${id}/original`).set('Range', 'bytes=2-5').expect(206);
      expect(res.text).toBe('2345');
      expect(res.headers['content-range']).toBe('bytes 2-5/10');
    });
  });
});
