import { formatBytes } from '../../lib/format';
import type { UploadLimits } from '../../services/api';

/**
 * Motivo de rechazo antes de enviar, con los límites que publica la API (uploadLimits).
 * El servidor vuelve a validar (y además comprueba el contenido real): esto solo ahorra un viaje.
 */
export function rejectReason(file: File, limits: UploadLimits): string | null {
  const dot = file.name.lastIndexOf('.');
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!limits.allowedExtensions.includes(extension)) {
    return `Formato no admitido. Use ${limits.allowedExtensions.join(', ')}.`;
  }
  if (file.size === 0) return 'El archivo está vacío.';
  if (file.size > limits.maxFileBytes) {
    return `Supera el máximo de ${formatBytes(limits.maxFileBytes)}. Reduzca su tamaño o divídalo en partes.`;
  }
  return null;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
};

/** Tipo por extensión, como lo decide el backend: `File.type` puede venir vacío para .md. */
export const mimeFromFilename = (name: string) =>
  MIME_BY_EXTENSION[name.slice(name.lastIndexOf('.')).toLowerCase()] ?? '';

/** "manual-de-despliegue.pdf" → "manual-de-despliegue": punto de partida editable del título. */
export const titleFromFilename = (name: string) => name.replace(/\.[^.]+$/, '');
