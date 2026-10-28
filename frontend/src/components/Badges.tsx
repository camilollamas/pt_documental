import { Check, TriangleAlert, X } from 'lucide-react';
import { formatLabel } from '../lib/format';
import type { DocumentStatus } from '../services/api';
import { Spinner } from './Button';

const statusStyles = {
  processing: 'bg-processing-soft text-processing',
  indexed: 'bg-indexed-soft text-indexed',
  error: 'bg-error-soft text-error',
  nocontent: 'bg-warning-soft text-warning',
} as const;

/** Estado del documento: palabra + icono + color (nunca solo color: indexed y error tienen la misma luminosidad). */
export function StatusBadge({ status, contentIndexed }: { status: DocumentStatus; contentIndexed: boolean }) {
  const icon = 'size-3 stroke-[2.25]';
  const [style, label, glyph] =
    status === 'PROCESANDO'
      ? [statusStyles.processing, 'Procesando', <Spinner key="s" className="size-2.5" />]
      : status === 'ERROR'
        ? [statusStyles.error, 'Error', <X key="x" className={icon} aria-hidden="true" />]
        : contentIndexed
          ? [statusStyles.indexed, 'Indexado', <Check key="c" className={icon} aria-hidden="true" />]
          : [statusStyles.nocontent, 'Sin contenido', <TriangleAlert key="t" className={icon} aria-hidden="true" />];

  return (
    <span className={`label-caps inline-flex items-center gap-1.5 whitespace-nowrap rounded-(--radius-sm) px-2 py-0.5 ${style}`}>
      {glyph}
      {label}
    </span>
  );
}

export function FormatBadge({ mimeType }: { mimeType: string }) {
  return (
    <span className="inline-block rounded-(--radius-sm) border border-rule-strong bg-sheet px-1.5 font-mono text-[11px] leading-4 font-semibold tracking-[0.04em] text-ink-muted">
      {formatLabel(mimeType)}
    </span>
  );
}
