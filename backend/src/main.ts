import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { appConfig } from './common/config.js';

try {
  process.loadEnvFile();
} catch {
  // .env es opcional: en Docker las variables llegan por el entorno.
}

const app = await NestFactory.create(AppModule);
configureApp(app);
await app.listen(appConfig().port);
