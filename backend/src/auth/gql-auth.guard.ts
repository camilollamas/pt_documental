import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';
import { extractBearerToken } from './auth.config.js';
import { AuthService } from './auth.service.js';

export const UNAUTHENTICATED_MESSAGE = 'Se requiere iniciar sesión como administrador';

/** Protege resolvers GraphQL que solo puede ejecutar el administrador. */
@Injectable()
export class GqlAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { req } = GqlExecutionContext.create(context).getContext<{ req: Request }>();
    if (await this.auth.isValidToken(extractBearerToken(req.headers.authorization))) {
      return true;
    }
    throw new UnauthorizedException(UNAUTHENTICATED_MESSAGE);
  }
}
