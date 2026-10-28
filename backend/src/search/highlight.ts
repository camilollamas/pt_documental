/**
 * ts_headline marca las coincidencias con caracteres de control en lugar de HTML (<b>…</b>):
 * la API devuelve segmentos { text, match } y el frontend pinta <mark> como nodos de texto.
 * Así ningún contenido del documento llega nunca a interpretarse como HTML (sin XSS).
 */
export const MATCH_START = '\u0002';
export const MATCH_END = '\u0003';
export const FRAGMENT_SEPARATOR = '\u0004';

export type HighlightSegment = { text: string; match: boolean };

export function parseHighlight(raw: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  const push = (text: string, match: boolean) => text && segments.push({ text, match });

  raw.split(MATCH_START).forEach((chunk, i) => {
    if (i === 0) return push(chunk, false);
    const [matched, ...rest] = chunk.split(MATCH_END);
    push(matched, true);
    push(rest.join(''), false);
  });
  return segments;
}

/** Fragmentos del contenido; los que no tienen ninguna coincidencia se descartan si hay alguno que sí. */
export function parseSnippets(raw: string): HighlightSegment[][] {
  const fragments = raw
    .split(FRAGMENT_SEPARATOR)
    .map((f) => parseHighlight(f.trim()))
    .filter((f) => f.length > 0);
  const withMatches = fragments.filter((f) => f.some((s) => s.match));
  return withMatches.length ? withMatches : fragments;
}
