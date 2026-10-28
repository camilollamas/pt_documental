import { Download, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { Alert } from '../../components/Alert';
import { FormatBadge } from '../../components/Badges';
import { buttonClass } from '../../components/button-class';
import { getOriginalText, originalUrl, type DocumentDetail } from '../../services/api';

/**
 * Muestra el documento sin descargarlo:
 * - PDF: el ORIGINAL embebido (visor nativo del navegador), nunca el texto extraído.
 * - Markdown: renderizado con react-markdown SIN HTML crudo (sin rehype-raw): una etiqueta <script>
 *   del documento se muestra como texto, no se ejecuta.
 * - TXT: texto preformateado, escapado por React.
 */
export function DocumentViewer({ doc }: { doc: DocumentDetail }) {
  const isPdf = doc.mimeType === 'application/pdf';

  return (
    <section aria-label="Contenido del documento" className="grid overflow-hidden rounded-(--radius-md) border border-rule bg-sheet">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2">
        <FormatBadge mimeType={doc.mimeType} />
        <span className="min-w-0 flex-1 truncate font-semibold">{doc.originalFilename}</span>
        <a className={buttonClass('ghost', 'sm')} href={originalUrl(doc.id)} target="_blank" rel="noreferrer">
          <ExternalLink className="size-4" aria-hidden="true" />
          Abrir en pestaña nueva
        </a>
        <a className={buttonClass('ghost', 'sm')} href={originalUrl(doc.id, true)}>
          <Download className="size-4" aria-hidden="true" />
          Descargar original
        </a>
      </div>
      <div className="grid min-h-[360px] bg-sunken">
        {isPdf ? (
          <iframe src={originalUrl(doc.id)} title={`Documento PDF: ${doc.title}`} className="h-[75vh] min-h-[480px] w-full border-0" />
        ) : (
          <TextContent doc={doc} />
        )}
      </div>
    </section>
  );
}

function TextContent({ doc }: { doc: DocumentDetail }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getOriginalText(doc.id, controller.signal)
      .then(setText)
      .catch((err: Error) => err.name !== 'AbortError' && setError(err.message));
    return () => controller.abort();
  }, [doc.id]);

  if (error) {
    return (
      <div className="p-6">
        <Alert tone="error" title="El archivo original no está disponible">{error}</Alert>
      </div>
    );
  }
  if (text === null) return <p className="p-6 text-ink-muted">Cargando el documento…</p>;

  if (doc.mimeType === 'text/markdown') {
    return (
      <article className="prose-cajetin max-w-(--reading-max) p-6">
        <Markdown>{text}</Markdown>
      </article>
    );
  }
  return (
    <pre className="m-0 overflow-x-auto p-6 font-mono text-[13px] leading-5 whitespace-pre-wrap text-ink">{text}</pre>
  );
}
