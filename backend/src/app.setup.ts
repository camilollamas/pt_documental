import { INestApplication, ValidationPipe } from '@nestjs/common';
import graphqlUploadExpress from 'graphql-upload/graphqlUploadExpress.mjs';
import { appConfig } from './common/config.js';

/** Compartido por main.ts y las pruebas e2e para que ambos levanten la misma app. */
export function configureApp(app: INestApplication) {
  const { maxUploadBytes, maxFilesPerUpload } = appConfig();
  app.setGlobalPrefix('api');
  app.use(
    '/graphql',
    graphqlUploadExpress({
      // busboy corta al *alcanzar* fileSize, no al superarlo: +1 para que MAX_UPLOAD_BYTES sea un máximo inclusivo.
      maxFileSize: maxUploadBytes + 1,
      maxFiles: maxFilesPerUpload,
    }),
  );
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
}
