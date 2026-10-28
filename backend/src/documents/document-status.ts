import { registerEnumType } from '@nestjs/graphql';

// Literales tal como los define el enunciado (HU-01, HU-04).
export enum DocumentStatus {
  PROCESANDO = 'PROCESANDO',
  INDEXADO = 'INDEXADO',
  ERROR = 'ERROR',
}

registerEnumType(DocumentStatus, { name: 'DocumentStatus' });
