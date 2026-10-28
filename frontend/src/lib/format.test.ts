import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate, formatLabel, formatVersion } from './format';

describe('formatos', () => {
  it('formatea tamaños con coma decimal', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(18 * 1024)).toBe('18 KB');
    expect(formatBytes(2.4 * 1024 * 1024)).toBe('2,4 MB');
  });

  it('traduce el tipo MIME al distintivo de formato', () => {
    expect(formatLabel('application/pdf')).toBe('PDF');
    expect(formatLabel('text/markdown')).toBe('MD');
    expect(formatLabel('text/plain')).toBe('TXT');
  });

  it('formatea fechas como "28 oct 2026, 10:30", sin "de" ni puntos', () => {
    // La hora depende de la zona horaria de quien ejecuta: se comprueba la forma, y el día con una hora de mediodía UTC.
    expect(formatDate('2026-10-28T15:07:31Z')).toMatch(/^28 oct 2026, \d{2}:\d{2}$/);
    expect(formatDate('2026-01-05T12:00:00Z')).toMatch(/^5 ene 2026, \d{2}:\d{2}$/);
  });

  it('antepone v solo a versiones numéricas', () => {
    expect(formatVersion('2.1')).toBe('v2.1');
    expect(formatVersion('borrador')).toBe('borrador');
  });
});
