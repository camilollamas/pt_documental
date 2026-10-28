import { makePdf } from '../../test/pdf-fixture.js';
import { ExtractionError, extractDocumentText } from './text-extraction.js';

describe('extractDocumentText', () => {
  it('extrae el texto de un PDF conservando tildes', async () => {
    const pdf = makePdf(['Guía de instalación', 'Configuración de red']);
    await expect(extractDocumentText(pdf, 'application/pdf')).resolves.toBe(
      'Guía de instalación\nConfiguración de red',
    );
  });

  it('devuelve TXT y Markdown como texto, sin caracteres NUL', async () => {
    const md = Buffer.from('# Título\u0000\n\nTexto **técnico**');
    await expect(extractDocumentText(md, 'text/markdown')).resolves.toBe(
      '# Título\n\nTexto **técnico**',
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
