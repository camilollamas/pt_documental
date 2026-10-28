import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { GqlAuthGuard } from './gql-auth.guard.js';

/** Contexto GraphQL mínimo: Nest guarda (root, args, context, info) como argumentos. */
function gqlContext(authorization?: string): ExecutionContext {
  const args = [{}, {}, { req: { headers: { authorization } } }, {}];
  return {
    getType: () => 'graphql',
    getArgs: () => args,
    getArgByIndex: (i: number) => args[i],
    getClass: () => Object,
    getHandler: () => () => undefined,
  } as unknown as ExecutionContext;
}

describe('GqlAuthGuard', () => {
  const auth = { isValidToken: async (t?: string) => t === 'valido' } as AuthService;
  const guard = new GqlAuthGuard(auth);

  it('deja pasar un Bearer válido', async () => {
    await expect(guard.canActivate(gqlContext('Bearer valido'))).resolves.toBe(true);
  });

  it.each([undefined, 'valido', 'Basic valido', 'Bearer otro'])(
    'rechaza la cabecera %s',
    async (header) => {
      await expect(guard.canActivate(gqlContext(header))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    },
  );
});
