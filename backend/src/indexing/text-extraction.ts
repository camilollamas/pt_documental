import { extractText, getDocumentProxy } from 'unpdf';

/** Fallo propio del documento: reintentar no lo arregla, así que pasa directo a ERROR. */
export class ExtractionError extends Error {}

/**
 * Devuelve el texto plano a indexar, o '' si el documento no tiene texto extraíble
 * (p. ej. un PDF escaneado: no se aplica OCR). Markdown se indexa tal cual: el parser de
 * PostgreSQL descarta `#`, `*`, `>`… al construir el tsvector.
 */
export async function extractDocumentText(content: Buffer, mimeType: string): Promise<string> {
  const raw = mimeType === 'application/pdf' ? await extractPdf(content) : content.toString('utf8');
  // PostgreSQL no admite el carácter NUL en columnas TEXT; algunos PDF lo producen.
  return raw.replaceAll('\u0000', '').trim();
}

async function extractPdf(content: Buffer): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(content), { verbosity: 0 });
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch (error) {
    const name = (error as Error).name;
    throw new ExtractionError(
      name === 'PasswordException'
        ? 'El PDF está protegido con contraseña'
        : 'El PDF está dañado o no se puede leer',
    );
  }
}
