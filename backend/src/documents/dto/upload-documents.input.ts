import { Field, InputType } from '@nestjs/graphql';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

@InputType()
export class DocumentMetadataInput {
  @Field()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @Field()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  author: string;

  @Field()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  category: string;

  @Field(() => [String], { defaultValue: [] })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? [...new Set(value.map((t) => String(t).trim()).filter(Boolean))]
      : value,
  )
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags: string[];

  @Field()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  version: string;
}

/**
 * Metadatos del lote. `documents[i]` describe `files[i]` de la mutación: los binarios
 * viajan en un argumento aparte para que la validación de DTOs nunca toque los streams.
 */
@InputType()
export class UploadDocumentsInput {
  @Field(() => [DocumentMetadataInput])
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DocumentMetadataInput)
  documents: DocumentMetadataInput[];
}
