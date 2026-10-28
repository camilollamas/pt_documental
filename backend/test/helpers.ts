import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { Queue } from 'bullmq';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { INDEXING_QUEUE } from '../src/indexing/indexing-queue.module.js';

export const ADMIN = { username: 'admin', password: 'clave-de-prueba-segura' };

/** Levanta la app completa contra la base de pruebas, con credenciales de administrador de prueba. */
export async function createTestApp(env: Record<string, string> = {}): Promise<INestApplication> {
  Object.assign(process.env, {
    DATABASE_URL:
      process.env.TEST_DATABASE_URL ?? 'postgres://docs:docs_local@localhost:5432/documents_test',
    // Base Redis 1: la cola de pruebas no se mezcla con la de la demo (base 0).
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
    ADMIN_USERNAME: ADMIN.username,
    ADMIN_PASSWORD_HASH: await bcrypt.hash(ADMIN.password, 4), // coste bajo: solo pruebas
    JWT_SECRET: 'secreto-de-pruebas-con-mas-de-32-caracteres',
    ...env,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  // Cada archivo de pruebas empieza con la cola vacía.
  await app.get<Queue>(getQueueToken(INDEXING_QUEUE)).obliterate({ force: true });
  return app;
}

export type TestFile = { name: string; content: Buffer };

export const UPLOAD_MUTATION = `
  mutation Upload($files: [Upload!]!, $input: UploadDocumentsInput!) {
    uploadDocuments(files: $files, input: $input) { filename id status error }
  }`;

export const metadata = (title: string) => ({
  title,
  author: 'Equipo QA',
  category: 'Manual',
  tags: ['api', ' api ', 'pruebas'],
  version: '1.0',
});

/** Construye la petición según https://github.com/jaydenseric/graphql-multipart-request-spec */
export function uploadRequest(
  app: INestApplication,
  files: TestFile[],
  headers: Record<string, string>,
  documents = files.map((f) => metadata(f.name)),
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

export async function loginAsAdmin(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send(ADMIN).expect(200);
  return res.body.accessToken;
}
