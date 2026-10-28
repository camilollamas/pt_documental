import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { buttonClass } from '../../components/button-class';
import { pageWindow } from './page-window';

type Props = { page: number; pageSize: number; total: number; hrefFor: (page: number) => string };

export function Pagination({ page, pageSize, total, hrefFor }: Props) {
  const pages = Math.ceil(total / pageSize);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btn = `${buttonClass('secondary', 'sm')} min-w-(--control-height-sm) px-2`;
  const current = `${buttonClass('primary', 'sm')} min-w-(--control-height-sm) px-2`;
  const disabled = `${btn} pointer-events-none border-rule bg-sunken text-ink-muted`;

  return (
    <nav aria-label="Paginación de resultados" className="flex flex-wrap items-center justify-between gap-3">
      <span className="font-mono text-[13px] leading-5 tabular-nums">
        {from}–{to} de {total} {total === 1 ? 'resultado' : 'resultados'}
      </span>
      {pages > 1 && (
        <ol className="flex gap-1">
          <li>
            {page > 1 ? (
              <Link className={btn} to={hrefFor(page - 1)} aria-label="Página anterior">
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Link>
            ) : (
              <span className={disabled} aria-disabled="true" aria-label="Página anterior">
                <ChevronLeft className="size-4" aria-hidden="true" />
              </span>
            )}
          </li>
          {pageWindow(page, pages).map((p, i) => (
            <li key={`${p}-${i}`}>
              {p === '…' ? (
                <span className="inline-flex h-(--control-height-sm) items-center px-1 text-ink-muted">…</span>
              ) : (
                <Link className={p === page ? current : btn} to={hrefFor(p)} aria-current={p === page ? 'page' : undefined}>
                  {p}
                </Link>
              )}
            </li>
          ))}
          <li>
            {page < pages ? (
              <Link className={btn} to={hrefFor(page + 1)} aria-label="Página siguiente">
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            ) : (
              <span className={disabled} aria-disabled="true" aria-label="Página siguiente">
                <ChevronRight className="size-4" aria-hidden="true" />
              </span>
            )}
          </li>
        </ol>
      )}
    </nav>
  );
}
