import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IndexingService } from './indexing/indexing.service.js';
import { WorkerModule } from './indexing/worker.module.js';

try {
  process.loadEnvFile();
} catch {
  // .env es opcional: en Docker las variables llegan por el entorno.
}

const app = await NestFactory.createApplicationContext(WorkerModule);
// SIGTERM/SIGINT cierran el worker ordenadamente: el trabajo en curso termina antes de salir.
app.enableShutdownHooks();

const requeued = await app.get(IndexingService).requeuePending();
new Logger('Worker').log(`Worker de indexación listo; ${requeued} documento(s) pendientes reencolados`);
