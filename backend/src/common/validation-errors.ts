import { BadRequestException, ValidationError } from '@nestjs/common';

/** Nombres en español de los campos que valida la API (REST y GraphQL). */
const FIELDS: Record<string, string> = {
  title: 'título',
  author: 'autor',
  category: 'categoría',
  version: 'versión',
  tags: 'etiquetas',
  documents: 'documentos',
  query: 'consulta',
  page: 'página',
  pageSize: 'tamaño de página',
  ids: 'documentos seguidos',
  username: 'usuario',
  password: 'contraseña',
};

/**
 * class-validator redacta sus mensajes en inglés y sin forma de pasarle otro idioma globalmente.
 * Se traduce por regla. El límite numérico ($constraint1) es el último número del mensaje original
 * ("must be shorter than or equal to 200 characters"); lo cubren las pruebas e2e.
 */
const RULES: Record<string, (limit: string | undefined) => string> = {
  isNotEmpty: () => 'es obligatorio',
  isString: () => 'debe ser texto',
  maxLength: (n) => `admite como máximo ${n} caracteres`,
  arrayMaxSize: (n) => `admite como máximo ${n} elementos`,
  arrayMinSize: (n) => `debe tener al menos ${n} elemento`,
  isInt: () => 'debe ser un número entero',
  min: (n) => `debe ser como mínimo ${n}`,
  max: (n) => `debe ser como máximo ${n}`,
  isUuid: () => 'debe contener identificadores válidos',
  // Único uso de @Matches: texto de metadatos limpio (ver upload-documents.input.ts).
  matches: () => 'contiene caracteres no válidos (texto dañado o de control): envíe texto UTF-8 de una sola línea',
};

function label(path: string[]): string {
  // documents.0.title → "Documento 1 · título"
  const parts: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const index = Number(path[i + 1]);
    if (path[i] === 'documents' && Number.isInteger(index)) {
      parts.push(`Documento ${index + 1}`);
      i++;
    } else if (!/^\d+$/.test(path[i])) {
      parts.push(FIELDS[path[i]] ?? path[i]);
    }
  }
  return parts.join(' · ');
}

function messages(errors: ValidationError[], parent: string[] = []): string[] {
  return errors.flatMap((error) => {
    const path = [...parent, error.property];
    const own = Object.entries(error.constraints ?? {}).map(([rule, original]) => {
      const translate = RULES[rule];
      return translate ? `${label(path)}: ${translate(original.match(/\d+(?!.*\d)/)?.[0])}` : original;
    });
    return [...own, ...messages(error.children ?? [], path)];
  });
}

/** exceptionFactory del ValidationPipe: 400 con la lista de errores por campo, en español. */
export function validationExceptionFactory(errors: ValidationError[]) {
  return new BadRequestException(messages(errors));
}
