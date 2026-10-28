import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { appConfig } from '../common/config.js';
import { DocumentEntity } from '../documents/document.entity.js';
import { CreateDocuments1793145600000 } from './migrations/1793145600000-CreateDocuments.js';

export function typeOrmOptions(): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    url: appConfig().databaseUrl,
    entities: [DocumentEntity],
    // Clases importadas en lugar de globs: funciona igual en ESM, en dist/ y en Vitest.
    migrations: [CreateDocuments1793145600000],
    // ponytail: la API aplica las migraciones al arrancar; con varias réplicas, pasar a un paso de despliegue (migration:run).
    migrationsRun: true,
    synchronize: false,
  };
}
