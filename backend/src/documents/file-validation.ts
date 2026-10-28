import { basename, extname } from 'node:path';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
};

export const ALLOWED_EXTENSIONS = Object.keys(MIME_BY_EXTENSION);

export function mimeFromFilename(filename: string): string | undefined {
  return MIME_BY_EXTENSION[extname(filename).toLowerCase()];
}

/**
 * La extensión la decide el cliente, así que se contrasta con el contenido real:
 * un PDF debe empezar por la firma `%PDF-`; TXT/MD deben ser UTF-8 válido sin bytes nulos.
 */
export function contentMatchesMime(mime: string, content: Buffer): boolean {
  if (mime === 'application/pdf') {
    return content.subarray(0, 5).toString('latin1') === '%PDF-';
  }
  if (content.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content);
    return true;
  } catch {
    return false;
  }
}

/** Motivo por el que el contenido no se acepta, o undefined si es válido. */
export function contentProblem(mime: string, content: Buffer): string | undefined {
  if (content.length === 0) return 'El archivo está vacío';
  if (!contentMatchesMime(mime, content)) return 'El contenido del archivo no corresponde a su extensión';
  return undefined;
}

/** Solo para mostrarlo como metadato: el archivo se guarda con un nombre generado. */
export function sanitizeFilename(filename: string): string {
  const clean = basename(filename.replaceAll('\\', '/'))
    .replace(/[\p{Cc}"]/gu, '')
    .trim();
  return clean.slice(0, 255) || 'documento';
}
