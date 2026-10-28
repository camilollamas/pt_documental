import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { ADMIN, createTestApp, loginAsAdmin, metadata, uploadRequest } from './helpers.js';

const txt = { name: 'a.txt', content: Buffer.from('contenido') };

describe('Manejo uniforme de errores (en español)', () => {
  let app: INestApplication;
  let storageDir: string;
  let headers: Record<string, string>;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'docs-errors-e2e-'));
    app = await createTestApp({ STORAGE_DIR: storageDir, MAX_FILES_PER_UPLOAD: '2', LOGIN_MAX_ATTEMPTS_PER_MINUTE: '100' });
    headers = { 'apollo-require-preflight': 'true', authorization: `Bearer ${await loginAsAdmin(app)}` };
  });

  afterAll(async () => {
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  const http = () => request(app.getHttpServer());

  describe('REST: { statusCode, error, message }', () => {
    it('traduce la validación de DTOs y nombra los campos', async () => {
      const res = await http().post('/api/auth/login').send({ username: '' }).expect(400);
      expect(res.body).toEqual({
        statusCode: 400,
        error: 'Solicitud no válida',
        message: expect.arrayContaining(['usuario: es obligatorio', 'contraseña: es obligatorio']),
      });
    });

    it('traduce límites numéricos con su valor', async () => {
      const res = await http().get('/api/documents').query({ query: 'x', pageSize: 51, page: 0 }).expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining(['tamaño de página: debe ser como máximo 50', 'página: debe ser como mínimo 1']),
      );
    });

    it('responde en español a un id inválido, un documento inexistente y una ruta inexistente', async () => {
      expect((await http().get('/api/documents/no-es-uuid').expect(400)).body.message).toBe(
        'El identificador del documento no es válido',
      );
      expect((await http().get(`/api/documents/${randomUUID()}`).expect(404)).body).toEqual({
        statusCode: 404,
        error: 'No encontrado',
        message: 'Documento no encontrado',
      });
      expect((await http().get('/api/no-existe').expect(404)).body.message).toBe('Ruta no encontrada');
    });

    it('valida los ids del flujo SSE en español', async () => {
      const res = await http().get('/api/events?ids=no-es-uuid').expect(400);
      expect(res.body.message).toEqual(['documentos seguidos: debe contener identificadores válidos']);
    });

    it('errores de cliente de Express (JSON mal formado, cuerpo demasiado grande) conservan su código', async () => {
      const malformed = await http().post('/api/auth/login').set('content-type', 'application/json').send('{"username":').expect(400);
      expect(malformed.body).toEqual({ statusCode: 400, error: 'Solicitud no válida', message: 'La solicitud no es válida.' });
      const huge = await http().post('/api/auth/login').send({ username: 'x'.repeat(200_000), password: 'x' }).expect(413);
      expect(huge.body.message).toBe('La solicitud supera el tamaño máximo permitido.');
    });

    it('mantiene los mensajes propios de la API (credenciales)', async () => {
      const res = await http().post('/api/auth/login').send({ ...ADMIN, password: 'mala' }).expect(401);
      expect(res.body).toEqual({ statusCode: 401, error: 'No autorizado', message: 'Credenciales inválidas' });
    });
  });

  describe('GraphQL: { message, extensions: { code, details } }', () => {
    it('un error de validación muestra el mensaje real (no "Bad Request Exception") y el documento afectado', async () => {
      const res = await uploadRequest(app, [txt], headers, [{ ...metadata('x'), title: 'x'.repeat(201) }]);
      const [error] = res.body.errors;
      expect(error.message).toBe('Documento 1 · título: admite como máximo 200 caracteres');
      expect(error.extensions).toEqual({
        code: 'BAD_REQUEST',
        details: ['Documento 1 · título: admite como máximo 200 caracteres'],
      });
    });

    it('nunca incluye originalError ni trazas de pila', async () => {
      const res = await uploadRequest(app, [txt], headers, [{ ...metadata('x'), author: '' }]);
      const extensions = res.body.errors[0].extensions;
      expect(extensions).not.toHaveProperty('originalError');
      expect(extensions).not.toHaveProperty('stacktrace');
      expect(res.body.errors[0].message).toBe('Documento 1 · autor: es obligatorio');
    });

    it('rechaza metadatos con caracteres de control (romperían el resaltado) o texto dañado', async () => {
      const control = await uploadRequest(app, [txt], headers, [{ ...metadata('x'), title: 'a\u0002b', tags: ['ok', 'c\u0003d'] }]);
      expect(control.body.errors[0].extensions.details).toEqual([
        'Documento 1 · título: contiene caracteres no válidos (texto dañado o de control): envíe texto UTF-8 de una sola línea',
        'Documento 1 · etiquetas: contiene caracteres no válidos (texto dañado o de control): envíe texto UTF-8 de una sola línea',
      ]);
      const damaged = await uploadRequest(app, [txt], headers, [{ ...metadata('x'), author: 'Jos\uFFFD' }]);
      expect(damaged.body.errors[0].message).toMatch(/^Documento 1 · autor: contiene caracteres no válidos/);
    });

    it('etiquetas: nombra el documento y la regla', async () => {
      const tags = Array.from({ length: 21 }, (_, i) => `t${i}`);
      const res = await uploadRequest(app, [txt], headers, [{ ...metadata('x'), tags }]);
      expect(res.body.errors[0].message).toBe('Documento 1 · etiquetas: admite como máximo 20 elementos');
    });
  });

  describe('Multipart (graphql-upload): formato GraphQL en lugar de una página HTML', () => {
    it('lote por encima del máximo de archivos → 413 con mensaje en español', async () => {
      const res = await uploadRequest(app, [txt, txt, txt], headers).expect(413);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.body).toEqual({
        errors: [{ message: 'El lote supera el máximo de archivos permitido.', extensions: { code: 'PAYLOAD_TOO_LARGE' } }],
      });
    });
  });
});
