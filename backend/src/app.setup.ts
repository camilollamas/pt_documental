import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import graphqlUploadExpress from 'graphql-upload/graphqlUploadExpress.mjs';
import { extractBearerToken } from './auth/auth.config.js';
import { AuthService } from './auth/auth.service.js';
import { UNAUTHENTICATED_MESSAGE } from './auth/gql-auth.guard.js';
import { appConfig } from './common/config.js';

/** Compartido por main.ts y las pruebas e2e para que ambos levanten la misma app. */
export function configureApp(app: INestApplication) {
  const { maxUploadBytes, maxFilesPerUpload } = appConfig();
  const auth = app.get(AuthService);

  app.setGlobalPrefix('api');

  // Solo la carga usa multipart. Se rechaza sin token *antes* de recibir los archivos: el guard
  // del resolver llegaría tarde, cuando graphql-upload ya habría leído hasta 10 × MAX_UPLOAD_BYTES.
  app.use('/graphql', async (req: Request, res: Response, next: NextFunction) => {
    if (!req.is('multipart/form-data')) return next();
    if (await auth.isValidToken(extractBearerToken(req.headers.authorization))) return next();
    res.status(401).json({
      errors: [{ message: UNAUTHENTICATED_MESSAGE, extensions: { code: 'UNAUTHENTICATED' } }],
    });
  });

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
