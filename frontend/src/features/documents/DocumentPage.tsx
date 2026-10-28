import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { Alert } from '../../components/Alert';
import { getDocument, type DocumentDetail } from '../../services/api';
import { Cajetin } from './Cajetin';
import { DocumentViewer } from './DocumentViewer';

type Outcome = { id: string } & ({ kind: 'error'; message: string } | { kind: 'done'; doc: DocumentDetail });

export function DocumentPage() {
  const { id = '' } = useParams();
  // La búsqueda de origen viaja en el estado de navegación; con un enlace directo se vuelve a Buscar.
  const backSearch = (useLocation().state as { search?: string } | null)?.search ?? '';
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getDocument(id, controller.signal)
      .then((doc) => setOutcome({ id, kind: 'done', doc }))
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setOutcome({ id, kind: 'error', message: error.message });
      });
    return () => controller.abort();
  }, [id]);

  const state = outcome?.id === id ? outcome : null;

  return (
    <section className="grid gap-6">
      <Link to={`/buscar${backSearch}`} className="inline-flex w-fit items-center gap-1 text-[13px] font-semibold text-accent">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {backSearch ? 'Volver a los resultados' : 'Ir a Buscar'}
      </Link>
      {!state && <p className="text-ink-muted">Cargando el documento…</p>}
      {state?.kind === 'error' && <Alert tone="error" title="No se pudo abrir el documento">{state.message}</Alert>}
      {state?.kind === 'done' && (
        <>
          <h1 className="sr-only">{state.doc.title}</h1>
          <Cajetin doc={state.doc} />
          <DocumentViewer doc={state.doc} />
        </>
      )}
    </section>
  );
}
