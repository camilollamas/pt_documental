import { makePdf } from '../../test/pdf-fixture.js';
import { ExtractionError, extractDocumentText } from './text-extraction.js';

describe('extractDocumentText', () => {
  it('extrae el texto de un PDF conservando tildes', async () => {
    const pdf = makePdf(['Guía de instalación', 'Configuración de red']);
    await expect(extractDocumentText(pdf, 'application/pdf')).resolves.toBe(
      'Guía de instalación\nConfiguración de red',
    );
  });

  it('devuelve TXT y Markdown como texto, sin NUL y con el resto de caracteres de control como espacios', async () => {
    // NUL (no cabe en TEXT de PostgreSQL) se elimina sin partir la palabra; U+0002–U+0004 (marcadores
    // del resaltado) se vuelven espacios; tabuladores y saltos de línea se conservan.
    const md = Buffer.from('# Tít\u0000ulo\n\nTexto\u0002**técnico**\u0004fin\tcolumna');
    await expect(extractDocumentText(md, 'text/markdown')).resolves.toBe(
      '# Título\n\nTexto **técnico** fin\tcolumna',
    );
  });

  it('clasifica como error definitivo un PDF dañado', async () => {
    const corrupt = Buffer.from('%PDF-1.4 contenido sin estructura válida');
    await expect(extractDocumentText(corrupt, 'application/pdf')).rejects.toThrow(
      new ExtractionError('El PDF está dañado o no se puede leer'),
    );
  });

  it('devuelve cadena vacía (no error) para un PDF sin texto o un texto en blanco', async () => {
    await expect(extractDocumentText(makePdf([]), 'application/pdf')).resolves.toBe('');
    await expect(extractDocumentText(Buffer.from('  \n\t '), 'text/plain')).resolves.toBe('');
  });
});
