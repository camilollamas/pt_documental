import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ADMIN, createTestApp, loginAsAdmin, uploadRequest } from './helpers.js';

const txt = { name: 'nota.txt', content: Buffer.from('contenido') };
const preflight = { 'apollo-require-preflight': 'true' };

describe('Autenticación del administrador', () => {
  let app: INestApplication;
  let storageDir: string;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'docs-auth-e2e-'));
    // Límite alto aquí: el bloqueo por intentos se prueba con su propia instancia más abajo.
    app = await createTestApp({ STORAGE_DIR: storageDir, LOGIN_MAX_ATTEMPTS_PER_MINUTE: '100' });
    await app.get(DataSource).query('TRUNCATE documents');
  });

  afterAll(async () => {
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  const http = () => request(app.getHttpServer());

  it('devuelve un JWT de 8 horas con credenciales correctas', async () => {
    const res = await http().post('/api/auth/login').send(ADMIN).expect(200);

    expect(res.body.expiresIn).toBe('8h');
    const payload = app.get(JwtService).decode(res.body.accessToken);
    expect(payload.sub).toBe(ADMIN.username);
    expect(payload.exp - payload.iat).toBe(8 * 60 * 60);
  });

  it('responde lo mismo ante contraseña o usuario incorrectos (no revela cuál falló)', async () => {
    const wrongPassword = await http()
      .post('/api/auth/login')
      .send({ ...ADMIN, password: 'incorrecta' })
      .expect(401);
    const wrongUser = await http()
      .post('/api/auth/login')
      .send({ ...ADMIN, username: 'otro' })
      .expect(401);

    expect(wrongPassword.body.message).toBe('Credenciales inválidas');
    expect(wrongUser.body).toEqual(wrongPassword.body);
  });

  it('valida el cuerpo del login', async () => {
    await http().post('/api/auth/login').send({ username: 'admin' }).expect(400);
  });

  it('no expone registro de usuarios', async () => {
    await http().post('/api/auth/register').send(ADMIN).expect(404);
  });

  it('rechaza la carga sin token antes de procesar los archivos', async () => {
    const res = await uploadRequest(app, [txt], preflight).expect(401);
    expect(res.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
    expect(await app.get(DataSource).query('SELECT 1 FROM documents')).toHaveLength(0);
  });

  it('rechaza tokens inválidos, caducados o firmados con otro secreto', async () => {
    const jwt = app.get(JwtService);
    const tokens = [
      'no-es-un-jwt',
      jwt.sign({ sub: ADMIN.username }, { expiresIn: -10 }),
      new JwtService({ secret: 'otro-secreto-de-mas-de-32-caracteres!!' }).sign({ sub: 'admin' }),
    ];
    for (const token of tokens) {
      await uploadRequest(app, [txt], { ...preflight, authorization: `Bearer ${token}` }).expect(
        401,
      );
    }
  });

  it('permite la carga con un token válido', async () => {
    const token = await loginAsAdmin(app);
    const res = await uploadRequest(app, [txt], { ...preflight, authorization: `Bearer ${token}` });
    expect(res.body.data.uploadDocuments[0].status).toBe('PROCESANDO');
  });

  it('mantiene pública la consulta de límites', async () => {
    const res = await http()
      .post('/graphql')
      .send({ query: '{ uploadLimits { maxFiles } }' })
      .expect(200);
    expect(res.body.data.uploadLimits.maxFiles).toBeGreaterThan(0);
  });

  it('bloquea el login tras superar los intentos por minuto', async () => {
    const limited = await createTestApp({ LOGIN_MAX_ATTEMPTS_PER_MINUTE: '3' });
    try {
      const attempt = () =>
        request(limited.getHttpServer())
          .post('/api/auth/login')
          .send({ ...ADMIN, password: 'incorrecta' });
      for (let i = 0; i < 3; i++) await attempt().expect(401);
      await attempt().expect(429);
      // Bloqueado incluso con la contraseña correcta hasta que pase la ventana.
      await request(limited.getHttpServer()).post('/api/auth/login').send(ADMIN).expect(429);
    } finally {
      await limited.close();
    }
  });
});
