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
 * Texto de metadatos válido: sin U+FFFD (carácter de reemplazo: el texto llegó en otra codificación,
 * p. ej. curl en Windows con argumentos en la página de códigos del sistema) ni caracteres de control
 * (U+0000–U+001F: entre ellos los marcadores del resaltado de ts_headline). Se rechaza para no guardar
 * texto dañado.
 */
// oxlint-disable-next-line no-control-regex -- detectarlos es justo el objetivo
const CLEAN_TEXT = /^[^\uFFFD\u0000-\u001F]*$/;
const cleanText = (each = false) =>
  // El mensaje en español lo pone validation-errors.ts (regla "matches").
  Matches(CLEAN_TEXT, { each });

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

@InputType()
export class DocumentMetadataInput {
  @Field()
  @trim()
  @IsString()
  @IsNotEmpty()
  @cleanText()
  @MaxLength(200)
  title: string;

  @Field()
  @trim()
  @IsString()
  @IsNotEmpty()
  @cleanText()
  @MaxLength(120)
  author: string;

  @Field()
  @trim()
  @IsString()
  @IsNotEmpty()
  @cleanText()
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
  @cleanText(true)
  tags: string[];

  @Field()
  @trim()
  @IsString()
  @IsNotEmpty()
  @cleanText()
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
