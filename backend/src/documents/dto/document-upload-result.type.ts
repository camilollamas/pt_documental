import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { DocumentStatus } from '../document-status.js';

/** Resultado por archivo: un lote puede aceptar unos y rechazar otros. */
@ObjectType()
export class DocumentUploadResult {
  @Field()
  filename: string;

  @Field(() => ID, { nullable: true })
  id?: string;

  @Field(() => DocumentStatus, { nullable: true })
  status?: DocumentStatus;

  @Field({ nullable: true })
  error?: string;
}

@ObjectType()
export class UploadLimits {
  @Field(() => Int)
  maxFileBytes: number;

  @Field(() => Int)
  maxFiles: number;

  @Field(() => [String])
  allowedExtensions: string[];
}
