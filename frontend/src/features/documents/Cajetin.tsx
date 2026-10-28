import type { ReactNode } from 'react';
import { FormatBadge, StatusBadge } from '../../components/Badges';
import { formatBytes, formatDate, formatVersion } from '../../lib/format';
import type { DocumentDetail } from '../../services/api';

/**
 * Ficha de metadatos compuesta como el cajetín de un plano: retícula de celdas
 * (rótulo + valor) dentro de un marco grueso. Es un <dl>: se anuncia "Versión: v1.0".
 */
export function Cajetin({ doc }: { doc: DocumentDetail }) {
  return (
    // overflow-hidden recorta los bordes de las celdas del extremo, que si no se pintarían sobre el marco.
    <dl className="m-0 grid grid-cols-2 overflow-hidden border-2 border-ink bg-sheet sm:grid-cols-4">
      <Cell label="Título" className="col-span-2 sm:col-span-3">
        <span className="font-display text-[22px] leading-7 font-semibold">{doc.title}</span>
      </Cell>
      <Cell label="Estado">
        <StatusBadge status={doc.status} contentIndexed={doc.contentIndexed} />
      </Cell>
      <Cell label="Autor">{doc.author}</Cell>
      <Cell label="Categoría">{doc.category}</Cell>
      <Cell label="Versión" mono>{formatVersion(doc.version)}</Cell>
      <Cell label="Formato">
        <FormatBadge mimeType={doc.mimeType} />
      </Cell>
      <Cell label="Archivo" className="col-span-2">{doc.originalFilename}</Cell>
      <Cell label="Tamaño" mono>{formatBytes(doc.sizeBytes)}</Cell>
      <Cell label="Fecha de indexación" mono>{doc.indexedAt ? formatDate(doc.indexedAt) : '—'}</Cell>
      <Cell label="Etiquetas" className="col-span-2 sm:col-span-4">
        {doc.tags.length ? doc.tags.join(', ') : '—'}
      </Cell>
      {doc.status === 'ERROR' && doc.errorMessage && (
        <Cell label="Error" className="col-span-2 text-error sm:col-span-4">{doc.errorMessage}</Cell>
      )}
    </dl>
  );
}

function Cell({ label, children, className = '', mono }: { label: string; children: ReactNode; className?: string; mono?: boolean }) {
  return (
    // La retícula interior: cada celda dibuja su borde derecho e inferior; el marco exterior tapa los del borde.
    <div className={`-mr-px -mb-px grid min-w-0 content-start gap-0.5 border-r border-b border-rule-strong px-3 py-2 ${className}`}>
      <dt className="label-caps text-ink-muted">{label}</dt>
      <dd className={`m-0 wrap-anywhere ${mono ? 'font-mono text-[13px] leading-5 tabular-nums' : ''}`}>{children}</dd>
    </div>
  );
}
