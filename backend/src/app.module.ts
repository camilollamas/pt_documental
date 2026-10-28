import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Request } from 'express';
import { AuthModule } from './auth/auth.module.js';
import { HealthController } from './common/health.controller.js';
import { typeOrmOptions } from './database/typeorm.config.js';
import { DocumentsModule } from './documents/documents.module.js';
import { EventsModule } from './events/events.module.js';
import { UploadResolver } from './graphql/upload.resolver.js';

@Module({
  imports: [
    // forRootAsync: la configuración se lee al arrancar, después de cargar .env.
    TypeOrmModule.forRootAsync({ useFactory: typeOrmOptions }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      sortSchema: true,
      // csrfPrevention viene activo por defecto en Apollo Server 5: exige cabecera
      // `apollo-require-preflight` en peticiones multipart. Se deja explícito porque es una decisión de seguridad.
      csrfPrevention: true,
      // El guard de autenticación lee la cabecera Authorization desde aquí.
      context: ({ req }: { req: Request }) => ({ req }),
    }),
    AuthModule,
    DocumentsModule,
    EventsModule,
  ],
  controllers: [HealthController],
  providers: [UploadResolver],
})
export class AppModule {}
