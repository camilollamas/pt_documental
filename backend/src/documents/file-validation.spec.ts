import {
  contentMatchesMime,
  mimeFromFilename,
  sanitizeFilename,
} from './file-validation.js';

describe('file-validation', () => {
  it('resuelve el MIME solo para extensiones admitidas', () => {
    expect(mimeFromFilename('Manual.PDF')).toBe('application/pdf');
    expect(mimeFromFilename('guia.md')).toBe('text/markdown');
    expect(mimeFromFilename('notas.txt')).toBe('text/plain');
    expect(mimeFromFilename('virus.exe')).toBeUndefined();
    expect(mimeFromFilename('sin-extension')).toBeUndefined();
  });

  it('exige la firma %PDF- en los PDF', () => {
    expect(contentMatchesMime('application/pdf', Buffer.from('%PDF-1.7\n'))).toBe(true);
    expect(contentMatchesMime('application/pdf', Buffer.from('hola'))).toBe(false);
  });

  it('rechaza binarios disfrazados de texto', () => {
    expect(contentMatchesMime('text/plain', Buffer.from('ñandú ✓'))).toBe(true);
    expect(contentMatchesMime('text/plain', Buffer.from([0x68, 0x00, 0x69]))).toBe(false);
    expect(contentMatchesMime('text/markdown', Buffer.from([0xff, 0xfe, 0x41]))).toBe(false);
  });

  it('elimina rutas y caracteres de control del nombre', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\temp\\informe.pdf')).toBe('informe.pdf');
    expect(sanitizeFilename('a\u0000b"c.txt')).toBe('abc.txt');
    expect(sanitizeFilename('   ')).toBe('documento');
  });
});
