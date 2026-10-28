import { parseHighlight, parseSnippets } from './highlight.js';

describe('parseHighlight', () => {
  it('separa coincidencias y texto plano', () => {
    expect(parseHighlight('Guía de \u0002nginx\u0003 como \u0002proxy\u0003')).toEqual([
      { text: 'Guía de ', match: false },
      { text: 'nginx', match: true },
      { text: ' como ', match: false },
      { text: 'proxy', match: true },
    ]);
  });

  it('devuelve el HTML del documento como texto, sin interpretarlo', () => {
    expect(parseHighlight('<script>alert(1)</script> \u0002kafka\u0003')).toEqual([
      { text: '<script>alert(1)</script> ', match: false },
      { text: 'kafka', match: true },
    ]);
  });

  it('no produce segmentos vacíos', () => {
    expect(parseHighlight('')).toEqual([]);
    expect(parseHighlight('\u0002todo\u0003')).toEqual([{ text: 'todo', match: true }]);
  });
});

describe('parseSnippets', () => {
  it('divide fragmentos y prioriza los que tienen coincidencias', () => {
    const raw = 'inicio sin nada\u0004 texto con \u0002helm\u0003 ';
    expect(parseSnippets(raw)).toEqual([
      [
        { text: 'texto con ', match: false },
        { text: 'helm', match: true },
      ],
    ]);
  });

  it('conserva un fragmento de vista previa si ninguno tiene coincidencias', () => {
    expect(parseSnippets('vista previa del documento')).toEqual([
      [{ text: 'vista previa del documento', match: false }],
    ]);
    expect(parseSnippets('')).toEqual([]);
  });
});
