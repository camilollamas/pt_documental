import { CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

type Tone = 'info' | 'success' | 'warning' | 'error';

const tones: Record<Tone, { style: string; Icon: typeof Info }> = {
  info: { style: 'bg-processing-soft text-processing', Icon: Info },
  success: { style: 'bg-indexed-soft text-indexed', Icon: CircleCheck },
  warning: { style: 'bg-warning-soft text-warning', Icon: TriangleAlert },
  error: { style: 'bg-error-soft text-error', Icon: CircleX },
};

/** Aviso en línea. Solo los errores usan role="alert" (interrumpe al lector de pantalla). */
export function Alert({ tone, title, children }: { tone: Tone; title: string; children?: ReactNode }) {
  const { style, Icon } = tones[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-(--radius-md) border border-current px-4 py-3 ${style}`}
    >
      <Icon className="mt-1 size-4" aria-hidden="true" />
      <p className="m-0 font-semibold">{title}</p>
      {children && <div className="col-start-2 text-ink">{children}</div>}
    </div>
  );
}
