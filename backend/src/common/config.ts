import { resolve } from 'node:path';

// Se lee en tiempo de ejecución (no al importar) para que .env y los tests puedan fijar valores antes.
export function appConfig() {
  return {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl:
      process.env.DATABASE_URL ?? 'postgres://docs:docs_local@localhost:5432/documents',
    storageDir: resolve(process.env.STORAGE_DIR ?? './storage'),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),
    maxFilesPerUpload: Number(process.env.MAX_FILES_PER_UPLOAD ?? 10),
  };
}
