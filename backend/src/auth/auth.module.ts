import { Module } from '@nestjs/common';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { authConfig } from './auth.config.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GqlAuthGuard } from './gql-auth.guard.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const { jwtSecret, jwtExpiresIn } = authConfig();
        return {
          secret: jwtSecret,
          signOptions: {
            expiresIn: jwtExpiresIn as JwtSignOptions['expiresIn'],
            algorithm: 'HS256',
          },
          // Fijar el algoritmo al verificar impide aceptar tokens firmados con otro (p. ej. "none").
          verifyOptions: { algorithms: ['HS256'] },
        };
      },
    }),
    // ponytail: contador en memoria por instancia; con varias réplicas usar almacenamiento en Redis.
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ ttl: 60_000, limit: authConfig().loginMaxAttemptsPerMinute }],
        errorMessage: 'Demasiados intentos de inicio de sesión. Espere un minuto y vuelva a intentarlo.',
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, GqlAuthGuard],
  exports: [AuthService, GqlAuthGuard],
})
export class AuthModule {}
