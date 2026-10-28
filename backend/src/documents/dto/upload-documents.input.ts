import { Field, InputType } from '@nestjs/graphql';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * U+FFFD (�) es el carácter de reemplazo: aparece cuando el texto llegó en otra codificación (p. ej.
 * curl en Windows con argumentos en la página de códigos del sistema). Se rechaza para no guardar texto dañado.
 */
const NO_REPLACEMENT_CHAR = /^[^\uFFFD]*$/;
const utf8 = (each = false) =>
  Matches(NO_REPLACEMENT_CHAR, {
    each,
    message: '$property contiene caracteres dañados (�): envíe el texto codificado en UTF-8',
  });

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

@InputType()
export class DocumentMetadataInput {
  @Field()
  @trim()
  @IsString()
  @IsNotEmpty()
  @utf8()
  @MaxLength(200)
  title: string;

  @Field()
  @trim()
  @IsString()
  @IsNotEmpty()
  @utf8()
  @MaxLength(120)
  author: string;

  @Field()
  @trim()
  @IsString()
  @IsNotEmpty()
  @utf8()
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
  @utf8(true)
  tags: string[];

  @Field()
  @trim()
  @IsString()
  @IsNotEmpty()
  @utf8()
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
