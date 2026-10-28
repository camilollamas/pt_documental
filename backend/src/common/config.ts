import { resolve } from 'node:path';

// Se lee en tiempo de ejecución (no al importar) para que .env y los tests puedan fijar valores antes.
export function appConfig() {
  return {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl:
      process.env.DATABASE_URL ?? 'postgres://docs:docs_local@localhost:5432/documents',
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    indexingConcurrency: Number(process.env.INDEXING_CONCURRENCY ?? 2),
    storageDir: resolve(process.env.STORAGE_DIR ?? './storage'),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),
    maxFilesPerUpload: Number(process.env.MAX_FILES_PER_UPLOAD ?? 10),
    adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
    // Sin valores por defecto: credenciales y secreto deben venir del entorno (ver auth.config.ts).
    adminPasswordHash: process.env.ADMIN_PASSWORD_HASH ?? '',
    jwtSecret: process.env.JWT_SECRET ?? '',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
    loginMaxAttemptsPerMinute: Number(process.env.LOGIN_MAX_ATTEMPTS_PER_MINUTE ?? 5),
  };
}
