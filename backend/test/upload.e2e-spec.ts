import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

const MAX_BYTES = 1024;

const UPLOAD_MUTATION = `
  mutation Upload($files: [Upload!]!, $input: UploadDocumentsInput!) {
    uploadDocuments(files: $files, input: $input) { filename id status error }
  }`;

const metadata = (title: string) => ({
  title,
  author: 'Equipo QA',
  category: 'Manual',
  tags: ['api', ' api ', 'pruebas'],
  version: '1.0',
});

type TestFile = { name: string; content: Buffer };

describe('Carga de documentos (GraphQL multipart)', () => {
  let app: INestApplication;
  let db: DataSource;
  let storageDir: string;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'docs-e2e-'));
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ?? 'postgres://docs:docs_local@localhost:5432/documents_test';
    process.env.STORAGE_DIR = storageDir;
    process.env.MAX_UPLOAD_BYTES = String(MAX_BYTES);
    process.env.MAX_FILES_PER_UPLOAD = '3';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(DataSource);
  });

  beforeEach(() => db.query('TRUNCATE documents'));

  afterAll(async () => {
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  /** Construye la petición según https://github.com/jaydenseric/graphql-multipart-request-spec */
  function upload(
    files: TestFile[],
    documents = files.map((f) => metadata(f.name)),
    headers: Record<string, string> = { 'apollo-require-preflight': 'true' },
  ) {
    const operations = {
      query: UPLOAD_MUTATION,
      variables: { files: files.map(() => null), input: { documents } },
    };
    const map = Object.fromEntries(files.map((_, i) => [String(i), [`variables.files.${i}`]]));
    let req = request(app.getHttpServer())
      .post('/graphql')
      .set(headers)
      .field('operations', JSON.stringify(operations))
      .field('map', JSON.stringify(map));
    files.forEach((f, i) => (req = req.attach(String(i), f.content, f.name)));
    return req;
  }

  const txt = { name: 'guia.txt', content: Buffer.from('Guía de instalación del servidor') };
  const md = { name: 'readme.md', content: Buffer.from('# Arquitectura\n\nTexto **técnico**') };
  const pdf = { name: 'manual.pdf', content: Buffer.from('%PDF-1.4\n%%EOF\n') };

  it('acepta un lote TXT + MD + PDF y devuelve id y PROCESANDO por archivo', async () => {
    const res = await upload([txt, md, pdf]).expect(200);

    expect(res.body.errors).toBeUndefined();
    const results = res.body.data.uploadDocuments;
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.status).toBe('PROCESANDO');
      expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(r.error).toBeNull();
    }
    expect(new Set(results.map((r: { id: string }) => r.id)).size).toBe(3);
    expect(await readdir(storageDir)).toEqual(
      expect.arrayContaining(results.map((r: { id: string }) => r.id)),
    );

    const rows = await db.query(
      `SELECT id, title, tags, mime_type, size_bytes, status, storage_path FROM documents ORDER BY title`,
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r: { mime_type: string }) => r.mime_type).sort()).toEqual([
      'application/pdf',
      'text/markdown',
      'text/plain',
    ]);
    for (const row of rows) {
      expect(row.status).toBe('PROCESANDO');
      expect(row.tags).toEqual(['api', 'pruebas']);
      expect(row.storage_path).toBe(row.id);
    }
  });

  it('acepta un archivo justo en el límite y rechaza uno que lo supera por 1 byte', async () => {
    const res = await upload([
      { name: 'limite.txt', content: Buffer.alloc(MAX_BYTES, 'a') },
      { name: 'grande.txt', content: Buffer.alloc(MAX_BYTES + 1, 'a') },
    ]).expect(200);

    const [atLimit, tooLarge] = res.body.data.uploadDocuments;
    expect(atLimit.status).toBe('PROCESANDO');
    expect(tooLarge.status).toBeNull();
    expect(tooLarge.error).toMatch(/tamaño máximo/);
  });

  it('rechaza extensiones no admitidas y contenido que no corresponde a la extensión', async () => {
    const filesBefore = (await readdir(storageDir)).length;
    const res = await upload([
      { name: 'script.exe', content: Buffer.from('MZ') },
      { name: 'falso.pdf', content: Buffer.from('no soy un pdf') },
      { name: 'binario.txt', content: Buffer.from([0x00, 0x01, 0x02]) },
    ]).expect(200);

    const [exe, fakePdf, binary] = res.body.data.uploadDocuments;
    expect(exe.error).toMatch(/Formato no admitido/);
    expect(fakePdf.error).toMatch(/no corresponde/);
    expect(binary.error).toMatch(/no corresponde/);
    expect(res.body.data.uploadDocuments.every((r: { id: string }) => r.id === null)).toBe(true);
    expect(await db.query('SELECT 1 FROM documents')).toHaveLength(0);
    // Los rechazados no dejan archivos huérfanos en disco.
    expect((await readdir(storageDir)).length).toBe(filesBefore);
  });

  it('la base de datos impide estados inválidos y marcar INDEXADO sin índice', async () => {
    const insert = (status: string, vector: string | null) =>
      db.query(
        `INSERT INTO documents (title, author, category, version, original_filename, mime_type,
                                storage_path, size_bytes, status, search_vector, indexed_at)
         VALUES ('t', 'a', 'c', '1', 'f.txt', 'text/plain', 'p', 1, $1, $2::tsvector,
                 CASE WHEN $2::tsvector IS NULL THEN NULL ELSE now() END)`,
        [status, vector],
      );

    await expect(insert('PROCESSING', null)).rejects.toThrow(/documents_status_check/);
    await expect(insert('INDEXADO', null)).rejects.toThrow(/documents_indexed_has_vector/);
    await expect(insert('INDEXADO', 'manual:1A')).resolves.toBeDefined();
  });

  it('valida metadatos obligatorios', async () => {
    const res = await upload([txt], [{ ...metadata('x'), title: '   ' }]);
    expect(res.body.errors?.[0].extensions.code).toBe('BAD_REQUEST');
    expect(res.body.data).toBeNull();
  });

  it('exige el mismo número de archivos y metadatos', async () => {
    const res = await upload([txt, md], [metadata('solo uno')]);
    expect(res.body.errors?.[0].message).toMatch(/deben coincidir/);
  });

  it('rechaza lotes por encima del máximo de archivos', async () => {
    const res = await upload([txt, md, pdf, txt]);
    expect(res.status).toBe(413);
  });

  it('bloquea la petición multipart sin cabecera de preflight (protección CSRF)', async () => {
    const res = await upload([txt], undefined, {});
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/CSRF/i);
  });
});
