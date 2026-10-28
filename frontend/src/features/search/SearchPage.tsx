import { Search, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert } from '../../components/Alert';
import { FormatBadge } from '../../components/Badges';
import { Button } from '../../components/Button';
import { inputClass } from '../../components/Field';
import { Highlight } from '../../components/Highlight';
import { formatDate, formatVersion } from '../../lib/format';
import { searchDocuments, type SearchResponse } from '../../services/api';
import { totalLabel } from './page-window';
import { Pagination } from './Pagination';

type Outcome = { key: string } & ({ kind: 'error'; message: string } | { kind: 'done'; result: SearchResponse });
type State = { kind: 'idle' } | { kind: 'loading' } | Outcome;

/** La consulta vive en la URL (?q=&page=): se puede compartir, recargar y volver atrás. */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q')?.trim() ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const key = query ? `${query}\n${page}` : '';
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    searchDocuments(query, page, controller.signal)
      .then((result) => setOutcome({ key, kind: 'done', result }))
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setOutcome({ key, kind: 'error', message: error.message });
      });
    // Una búsqueda nueva cancela la anterior: nunca se pintan resultados de una consulta vieja.
    return () => controller.abort();
  }, [key, query, page]);

  // "Cargando" se deriva: hay consulta pero la última respuesta es de otra consulta o página.
  const state: State = !key ? { kind: 'idle' } : outcome?.key === key ? outcome : { kind: 'loading' };

  // Al llegar otra página, el foco vuelve al encabezado de resultados (útil con teclado y lector).
  // Depende solo de `outcome`: no debe robar el foco mientras el usuario escribe.
  useEffect(() => {
    if (outcome?.kind === 'done' && outcome.result.page > 1) resultsHeading.current?.focus();
  }, [outcome]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get('q') ?? '').trim();
    setParams(q ? { q } : {});
  }

  const hrefFor = (p: number) => `/buscar?${new URLSearchParams({ q: query, page: String(p) })}`;

  return (
    <section className="grid gap-6">
      <h1 className="font-display text-[32px] leading-[38px] font-semibold tracking-[-0.01em]">Buscar en la documentación</h1>

      <form role="search" onSubmit={onSubmit} className="grid gap-2">
        <div className="flex gap-2">
          <div className="relative flex min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            <label htmlFor="q" className="sr-only">
              Buscar en los documentos
            </label>
            <input
              key={query}
              id="q"
              name="q"
              type="search"
              defaultValue={query}
              maxLength={200}
              aria-describedby="q-hint"
              className={`${inputClass} h-12 flex-1 pl-10 text-[17px]`}
            />
          </div>
          <Button type="submit" variant="primary" className="h-12" busy={state.kind === 'loading'}>
            {state.kind === 'loading' ? 'Buscando…' : 'Buscar'}
          </Button>
        </div>
        <p id="q-hint" className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] leading-5 text-ink-muted">
          <span><Code>"frase exacta"</Code> literal</span>
          <span><Code>nginx -apache</Code> excluye</span>
          <span><Code>grafana or kibana</Code> cualquiera</span>
        </p>
      </form>

      {/* Anuncia el resultado de cada búsqueda a los lectores de pantalla. */}
      <p aria-live="polite" className="sr-only">
        {state.kind === 'done' && totalLabel(state.result.total, state.result.totalCapped)}
      </p>

      {state.kind === 'error' && <Alert tone="error" title="No se pudo completar la búsqueda">{state.message}</Alert>}

      {state.kind === 'done' && state.result.total === 0 && (
        <div className="grid gap-1 py-12">
          <p className="font-semibold">No hay documentos que contengan «{query}».</p>
          <p className="text-[13px] leading-5 text-ink-muted">Pruebe con menos términos, sin comillas o con otra palabra clave.</p>
        </div>
      )}

      {state.kind === 'done' && state.result.total > 0 && (
        <div className="grid gap-4">
          <h2 ref={resultsHeading} tabIndex={-1} className="sr-only">
            Resultados
          </h2>
          <ol className="grid">
            {state.result.items.map((item) => (
              <li key={item.id} className="grid max-w-(--reading-max) gap-1 border-b border-rule py-4">
                <h3 className="font-display text-[17px] leading-6 font-semibold">
                  <Link
                    to={`/documentos/${item.id}`}
                    state={{ search: `?${params}` }}
                    className="text-accent no-underline underline-offset-3 hover:underline"
                  >
                    <Highlight segments={item.titleHighlight} />
                  </Link>
                </h3>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-5 text-ink-muted">
                  <FormatBadge mimeType={item.mimeType} />
                  <span>{item.author}</span>
                  <span>{item.category}</span>
                  <span className="font-mono tabular-nums">
                    {formatVersion(item.version)} · {formatDate(item.createdAt)}
                  </span>
                </div>
                {item.contentIndexed ? (
                  item.snippets.map((snippet, i) => (
                    <p key={i} className="m-0">
                      {i > 0 && <span className="text-ink-muted">… </span>}
                      <Highlight segments={snippet} />
                    </p>
                  ))
                ) : (
                  <p className="m-0 flex items-center gap-1 text-[13px] leading-5 text-warning">
                    <TriangleAlert className="size-4" aria-hidden="true" />
                    Sin contenido: solo se encontró por título y metadatos.
                  </p>
                )}
              </li>
            ))}
          </ol>
          <Pagination page={state.result.page} pageSize={state.result.pageSize} total={state.result.total} totalCapped={state.result.totalCapped} hrefFor={hrefFor} />
        </div>
      )}
    </section>
  );
}

function Code({ children }: { children: string }) {
  return <code className="rounded-(--radius-sm) bg-sunken px-1 font-mono text-ink">{children}</code>;
}
