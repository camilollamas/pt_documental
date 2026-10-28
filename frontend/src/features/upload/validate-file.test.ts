import { describe, expect, it } from 'vitest';
import { titleFromFilename } from './validate-file';

describe('titleFromFilename', () => {
  it('quita la extensión y recorta al máximo de la API (200)', () => {
    expect(titleFromFilename('manual.de.despliegue.pdf')).toBe('manual.de.despliegue');
    expect(titleFromFilename(`${'a'.repeat(250)}.md`)).toHaveLength(200);
  });
});
