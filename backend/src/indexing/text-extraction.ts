import { extractText, getDocumentProxy } from 'unpdf';

/** Fallo propio del documento: reintentar no lo arregla, así que pasa directo a ERROR. */
export class ExtractionError extends Error {}

/**
 * Caracteres de control salvo tabulador y saltos de línea:
 * - NUL se elimina: PostgreSQL no lo admite en columnas TEXT, y algunos PDF lo emiten dentro de
 *   una palabra (sustituirlo por un espacio la partiría y dejaría de encontrarse);
 * - el resto se sustituye por un espacio (U+000C, salto de página, separa palabras). Entre ellos
 *   están U+0002…U+0004, los marcadores del resaltado de ts_headline (search/highlight.ts): si el
 *   documento los contuviera, desordenarían los fragmentos.
 */
// oxlint-disable-next-line no-control-regex -- detectarlos es justo el objetivo
const CONTROL_CHARS = /[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g;

/**
 * Devuelve el texto plano a indexar, o '' si el documento no tiene texto extraíble
 * (p. ej. un PDF escaneado: no se aplica OCR). Markdown se indexa tal cual: el parser de
 * PostgreSQL descarta `#`, `*`, `>`… al construir el tsvector.
 */
export async function extractDocumentText(content: Buffer, mimeType: string): Promise<string> {
  const raw = mimeType === 'application/pdf' ? await extractPdf(content) : content.toString('utf8');
  return raw.replaceAll('\0', '').replace(CONTROL_CHARS, ' ').trim();
}

async function extractPdf(content: Buffer): Promise<string> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    pdf = await getDocumentProxy(new Uint8Array(content), { verbosity: 0 });
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch (error) {
    const name = (error as Error).name;
    throw new ExtractionError(
      name === 'PasswordException'
        ? 'El PDF está protegido con contraseña'
        : 'El PDF está dañado o no se puede leer',
    );
  } finally {
    // unpdf solo libera los documentos que crea él (con loadingTask.destroy(), igual que aquí);
    // este lo creamos nosotros. Sin liberarlo, cada PDF dejaría memoria de pdf.js retenida en el
    // worker, que es un proceso de larga duración.
    await pdf?.loadingTask.destroy();
  }
}
