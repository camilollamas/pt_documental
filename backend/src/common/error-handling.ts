import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { GqlContextType } from '@nestjs/graphql';
import type { NextFunction, Request, Response } from 'express';
import type { GraphQLFormattedError } from 'graphql';

/**
 * Manejo uniforme de errores:
 * - REST: { statusCode, error, message } en español (HttpErrorFilter).
 * - GraphQL: { message, extensions: { code, details } } (formatGraphqlError).
 * - Errores de cliente de Express (JSON, multipart): el formato de su ruta (requestErrorHandler).
 * Un error no controlado nunca expone su mensaje interno (SQL, rutas…): se registra y se responde genérico.
 */
const logger = new Logger('Errores');

const STATUS_TEXT: Record<number, string> = {
  400: 'Solicitud no válida',
  401: 'No autorizado',
  403: 'Prohibido',
  404: 'No encontrado',
  413: 'Contenido demasiado grande',
  429: 'Demasiadas solicitudes',
  500: 'Error interno',
};
const INTERNAL_MESSAGE = 'Error interno del servidor. Inténtelo de nuevo más tarde.';

function httpMessage(exception: HttpException): string | string[] {
  const response = exception.getResponse();
  const message = typeof response === 'string' ? response : (response as { message?: string | string[] }).message;
  // Ruta inexistente: Nest responde "Cannot GET /x" en inglés.
  if (exception.getStatus() === 404 && typeof message === 'string' && message.startsWith('Cannot ')) {
    return 'Ruta no encontrada';
  }
  return message ?? exception.message;
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // En GraphQL el error sigue su curso hasta formatGraphqlError.
    if (host.getType<GqlContextType>() === 'graphql') return exception;

    const res = host.switchToHttp().getResponse<Response>();
    // p. ej. un flujo SSE o un archivo ya enviándose: no cabe otra respuesta, se cierra la conexión.
    if (res.headersSent) {
      res.end();
      return;
    }
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) logger.error((exception as Error)?.stack ?? String(exception));
    res.status(status).json({
      statusCode: status,
      error: STATUS_TEXT[status] ?? 'Error',
      message: status >= 500 ? INTERNAL_MESSAGE : httpMessage(exception as HttpException),
    });
  }
}

/** Errores GraphQL: mensaje legible, código y detalle por campo; sin `originalError` ni trazas. */
export function formatGraphqlError(formatted: GraphQLFormattedError, error: unknown): GraphQLFormattedError {
  const original = (error as { originalError?: unknown })?.originalError;
  const code = String(formatted.extensions?.code ?? 'INTERNAL_SERVER_ERROR');

  if (original instanceof HttpException) {
    const message = httpMessage(original);
    const details = Array.isArray(message) ? message : [message];
    return { message: details.join(' · '), path: formatted.path, extensions: { code, details } };
  }
  if (code === 'INTERNAL_SERVER_ERROR') {
    logger.error((original as Error)?.stack ?? formatted.message);
    return { message: INTERNAL_MESSAGE, path: formatted.path, extensions: { code } };
  }
  // Errores propios de GraphQL (sintaxis, variables): su mensaje es técnico pero no expone nada interno.
  return { message: formatted.message, locations: formatted.locations, path: formatted.path, extensions: { code } };
}

/**
 * Errores de cliente de los middlewares de Express (JSON mal formado, cuerpo demasiado grande,
 * multipart de graphql-upload), antes de llegar a Nest. Su texto original es interno y en inglés.
 * Lo demás (sin código o 5xx) sigue hacia Nest.
 */
export function requestErrorHandler(error: Error & { status?: number }, req: Request, res: Response, next: NextFunction) {
  const status = error.status;
  if (res.headersSent || !status || status >= 500) return next(error);
  const message =
    status !== 413
      ? 'La solicitud no es válida.'
      : // Texto de graphql-upload 17: "${maxFiles} max file uploads exceeded."
        /max file uploads exceeded/i.test(error.message)
        ? 'El lote supera el máximo de archivos permitido.'
        : 'La solicitud supera el tamaño máximo permitido.';
  if (req.originalUrl.startsWith('/graphql')) {
    res.status(status).json({ errors: [{ message, extensions: { code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST' } }] });
  } else {
    res.status(status).json({ statusCode: status, error: STATUS_TEXT[status] ?? STATUS_TEXT[400], message });
  }
}

/** UUID de ruta con mensaje en español (ParseUUIDPipe responde en inglés por defecto). */
export const DocumentIdPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException('El identificador del documento no es válido'),
});
