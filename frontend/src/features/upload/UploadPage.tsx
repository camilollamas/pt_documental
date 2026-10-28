import { Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Alert } from '../../components/Alert';
import { FormatBadge, StatusBadge } from '../../components/Badges';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { TagInput } from '../../components/TagInput';
import { formatBytes } from '../../lib/format';
import { ApiError, getUploadLimits, uploadDocuments, type UploadLimits, type UploadResult } from '../../services/api';
import { useAuth } from '../auth/auth-context';
import { useDocumentStatuses } from '../events/useDocumentStatuses';
import { Dropzone } from './Dropzone';
import { mimeFromFilename, rejectReason, titleFromFilename } from './validate-file';

type Draft = { key: string; file: File; title: string; version: string; tags: string[] };
type Rejected = { key: string; name: string; reason: string };
type Sent = UploadResult & { title: string; file: File };

// Mismos límites que valida la API (DocumentMetadataInput).
const MAX = { title: 200, author: 120, category: 80, version: 20 };

let nextKey = 0;
const newKey = () => String(++nextKey);

export function UploadPage() {
  const { session, expire } = useAuth();
  const [limits, setLimits] = useState<UploadLimits | null>(null);
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [common, setCommon] = useState({ author: '', category: '' });
  const [showErrors, setShowErrors] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getUploadLimits(controller.signal)
      .then(setLimits)
      .catch((error: Error) => error.name !== 'AbortError' && setLimitsError(error.message));
    return () => controller.abort();
  }, []);

  function addFiles(files: File[]) {
    if (!limits) return;
    const accepted: Draft[] = [];
    const refused: Rejected[] = [];
    for (const file of files) {
      const reason =
        drafts.length + accepted.length >= limits.maxFiles
          ? `Supera el máximo de ${limits.maxFiles} archivos por lote. Súbalo en otro lote.`
          : rejectReason(file, limits);
      if (reason) refused.push({ key: newKey(), name: file.name, reason });
      else accepted.push({ key: newKey(), file, title: titleFromFilename(file.name), version: '1.0', tags: [] });
    }
    setDrafts((current) => [...current, ...accepted]);
    setRejected(refused);
  }

  const updateDraft = (key: string, change: Partial<Draft>) =>
    setDrafts((current) => current.map((d) => (d.key === key ? { ...d, ...change } : d)));

  const missing = (value: string) => (showErrors && !value.trim() ? 'Este dato es obligatorio.' : undefined);
  const isComplete =
    common.author.trim() && common.category.trim() && drafts.every((d) => d.title.trim() && d.version.trim());

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isComplete) return setShowErrors(true);
    setSending(true);
    setSendError(null);
    try {
      const results = await uploadDocuments(
        session!.token,
        drafts.map((d) => d.file),
        drafts.map((d) => ({
          title: d.title.trim(),
          author: common.author.trim(),
          category: common.category.trim(),
          tags: d.tags,
          version: d.version.trim(),
        })),
      );
      setSent(results.map((result, i) => ({ ...result, title: drafts[i].title.trim(), file: drafts[i].file })));
    } catch (error) {
      // Token caducado o revocado: RequireAdmin lleva al login, que explica el motivo.
      if (error instanceof ApiError && error.status === 401) return expire();
      setSendError((error as Error).message);
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setDrafts([]);
    setRejected([]);
    setSent(null);
    setShowErrors(false);
  }

  if (sent) return <UploadResults sent={sent} onReset={reset} />;

  return (
    <section className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="font-display text-[32px] leading-[38px] font-semibold tracking-[-0.01em]">Cargar documentos</h1>
        <p className="text-ink-muted">Se indexan en segundo plano: podrá buscarlos en cuanto pasen a Indexado.</p>
      </div>

      {limitsError && <Alert tone="error" title="No se pudieron obtener los límites de carga">{limitsError}</Alert>}
      {limits && <Dropzone limits={limits} disabled={sending} onFiles={addFiles} />}

      {rejected.length > 0 && (
        <Alert tone="error" title={rejected.length === 1 ? 'Un archivo no se añadió' : `${rejected.length} archivos no se añadieron`}>
          <ul className="m-0 grid gap-1 p-0">
            {rejected.map((r) => (
              <li key={r.key} className="list-none">
                <b className="wrap-anywhere">{r.name}</b>: {r.reason}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {drafts.length > 0 && (
        <form onSubmit={onSubmit} noValidate className="grid gap-6">
          <fieldset className="grid gap-4 rounded-(--radius-md) border border-rule bg-sheet p-4 sm:grid-cols-2">
            <legend className="px-1 font-display text-[17px] leading-6 font-semibold">Datos comunes del lote</legend>
            <Field
              label="Autor"
              value={common.author}
              maxLength={MAX.author}
              onChange={(e) => setCommon({ ...common, author: e.target.value })}
              error={missing(common.author)}
            />
            <Field
              label="Categoría"
              value={common.category}
              maxLength={MAX.category}
              placeholder="Manual, Guía, Especificación…"
              onChange={(e) => setCommon({ ...common, category: e.target.value })}
              error={missing(common.category)}
            />
          </fieldset>

          <ol className="grid gap-3 p-0">
            {drafts.map((draft) => (
              <li key={draft.key} className="grid list-none gap-3 rounded-(--radius-md) border border-rule bg-sheet p-4">
                <div className="flex items-center gap-3">
                  <FormatBadge mimeType={mimeFromFilename(draft.file.name)} />
                  <span className="min-w-0 flex-1 font-semibold wrap-anywhere">{draft.file.name}</span>
                  <span className="font-mono text-[13px] text-ink-muted tabular-nums">{formatBytes(draft.file.size)}</span>
                  <Button
                    variant="danger"
                    size="sm"
                    aria-label={`Quitar ${draft.file.name}`}
                    onClick={() => setDrafts((current) => current.filter((d) => d.key !== draft.key))}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                  <Field
                    label="Título"
                    value={draft.title}
                    maxLength={MAX.title}
                    onChange={(e) => updateDraft(draft.key, { title: e.target.value })}
                    error={missing(draft.title)}
                  />
                  <Field
                    label="Versión"
                    value={draft.version}
                    maxLength={MAX.version}
                    onChange={(e) => updateDraft(draft.key, { version: e.target.value })}
                    error={missing(draft.version)}
                  />
                </div>
                <TagInput id={`tags-${draft.key}`} label="Etiquetas" value={draft.tags} onChange={(tags) => updateDraft(draft.key, { tags })} />
              </li>
            ))}
          </ol>

          {sendError && <Alert tone="error" title="No se pudo subir el lote">{sendError}</Alert>}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={sending}>
              {sending ? 'Subiendo…' : `Subir ${drafts.length === 1 ? 'documento' : `${drafts.length} documentos`}`}
            </Button>
            <Button onClick={reset} disabled={sending}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Resultado del lote: una fila por archivo, con el estado actualizado en vivo por SSE. */
function UploadResults({ sent, onReset }: { sent: Sent[]; onReset: () => void }) {
  const ids = useMemo(() => sent.flatMap((s) => (s.id ? [s.id] : [])), [sent]);
  const live = useDocumentStatuses(ids);

  const rows = sent.map((s) => {
    const event = s.id ? live[s.id] : undefined;
    return { ...s, status: event?.status ?? s.status, contentIndexed: event?.contentIndexed ?? false, error: event?.errorMessage ?? s.error };
  });
  const pending = rows.filter((r) => r.id && r.status === 'PROCESANDO').length;
  const ready = rows.filter((r) => r.status === 'INDEXADO').length;
  const failed = rows.filter((r) => !r.id || r.status === 'ERROR').length;

  // Lo último que cambió, para la región aria-live (se deriva del evento más reciente).
  const lastChange = Object.values(live).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const lastRow = lastChange && rows.find((r) => r.id === lastChange.id);
  const announcement = lastRow
    ? `${lastRow.title}: ${lastRow.status === 'ERROR' ? 'error' : lastRow.contentIndexed ? 'indexado' : 'indexado sin contenido'}`
    : '';

  return (
    <section className="grid gap-6">
      <h1 className="font-display text-[32px] leading-[38px] font-semibold tracking-[-0.01em]">Cargar documentos</h1>
      <p aria-live="polite" className="sr-only">{announcement}</p>

      {pending > 0 ? (
        <Alert tone="info" title={pending === 1 ? '1 documento en proceso' : `${pending} documentos en proceso`}>
          Se indexan en segundo plano. Puede seguir trabajando: el estado se actualiza solo.
        </Alert>
      ) : (
        <Alert tone={failed ? 'warning' : 'success'} title="Lote procesado">
          {ready} de {sent.length} {sent.length === 1 ? 'documento listo' : 'documentos listos'} para buscar.
          {failed > 0 && ` ${failed} con error: revise el motivo en cada fila.`}
        </Alert>
      )}

      <ul className="m-0 grid rounded-(--radius-md) border border-rule bg-sheet p-0">
        {rows.map((row, i) => (
          <li
            key={`${row.filename}-${i}`}
            className="grid list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-rule px-4 py-3 not-first:border-t"
          >
            <FormatBadge mimeType={mimeFromFilename(row.file.name)} />
            <span className="font-semibold wrap-anywhere">
              {row.id && row.status === 'INDEXADO' ? <Link to={`/documentos/${row.id}`} className="text-accent">{row.title}</Link> : row.title}
            </span>
            {row.status ? <StatusBadge status={row.status} contentIndexed={row.contentIndexed} /> : <StatusBadge status="ERROR" contentIndexed={false} />}
            <span className="col-start-2 text-[13px] leading-5 text-ink-muted">
              {row.filename} · <span className="font-mono tabular-nums">{formatBytes(row.file.size)}</span>
              {row.status === 'INDEXADO' && !row.contentIndexed && ' · solo se encuentra por título y metadatos'}
            </span>
            {row.error && (
              <span className="col-span-2 col-start-2 text-[13px] leading-5 font-semibold text-error">{row.error}</span>
            )}
          </li>
        ))}
      </ul>

      <div>
        <Button variant="primary" onClick={onReset}>
          Subir más documentos
        </Button>
      </div>
    </section>
  );
}
