import { Fragment } from 'react';
import type { HighlightSegment } from '../services/api';

/**
 * Pinta las coincidencias como <mark> y el resto como texto. React escapa ambos.
 * Nunca innerHTML: ts_headline no escapa el HTML del documento y puede devolver
 * etiquetas a medias como `<img src=x onerror=alert`.
 */
export function Highlight({ segments }: { segments: HighlightSegment[] }) {
  return segments.map((segment, i) =>
    segment.match ? <mark key={i}>{segment.text}</mark> : <Fragment key={i}>{segment.text}</Fragment>,
  );
}
