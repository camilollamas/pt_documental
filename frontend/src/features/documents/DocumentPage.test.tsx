import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DocumentDetail } from '../../services/api';
import { FakeEventSource } from '../../test/fake-event-source';
import { json, mockFetch, renderApp } from '../../test/render';

const ID = '25adf9fb-31bf-43e8-b2ed-5f21a1daaab5';

const detail = (overrides: Partial<DocumentDetail> = {}): DocumentDetail => ({
  id: ID,
  title: 'Guía de observabilidad',
  author: 'Equipo SRE',
  category: 'Guía',
  tags: ['monitoreo', 'prometheus'],
  version: '1.0',
  originalFilename: 'observabilidad.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2.4 * 1024 * 1024,
  status: 'INDEXADO',
  contentIndexed: true,
  errorMessage: null,
  createdAt: '2026-10-28T15:07:31.568Z',
  indexedAt: '2026-10-28T15:07:31.696Z',
  ...overrides,
});

const routes = (doc: DocumentDetail, original?: string) => [
  (url: string) => (url === `/api/documents/${ID}` ? json(doc) : undefined),
  (url: string) => (original !== undefined && url === `/api/documents/${ID}/original` ? new Response(original) : undefined),
];

describe('Detalle del documento', () => {
  it('muestra el cajetín con los metadatos, el estado y el tamaño formateado', async () => {
    mockFetch(...routes(detail()));
    renderApp(`/documentos/${ID}`);

    const titleTerm = await screen.findByText('Título');
    const dl = titleTerm.closest('dl')!;
    expect(within(dl).getByText('Guía de observabilidad')).toBeInTheDocument();
    expect(within(dl).getByText('Indexado')).toBeInTheDocument();
    expect(within(dl).getByText('v1.0')).toBeInTheDocument();
    expect(within(dl).getByText('2,4 MB')).toBeInTheDocument();
    expect(within(dl).getByText('monitoreo, prometheus')).toBeInTheDocument();
  });

  it('embebe el PDF ORIGINAL (no el texto extraído) y ofrece descargarlo sin obligar', async () => {
    mockFetch(...routes(detail()));
    renderApp(`/documentos/${ID}`);

    const frame = await screen.findByTitle('Documento PDF: Guía de observabilidad');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', `/api/documents/${ID}/original`);
    expect(screen.getByRole('link', { name: 'Descargar original' })).toHaveAttribute('href', `/api/documents/${ID}/original?download=1`);
  });

  it('renderiza Markdown sin ejecutar ni insertar el HTML que contenga', async () => {
    const markdown =
      '# Respaldo\n\nUsar `pg_dump`. [Ver guía](javascript:alert(1))\n\n<script>window.hackeado = true</script>\n\n<img src=x onerror="alert(1)">';
    mockFetch(...routes(detail({ mimeType: 'text/markdown', originalFilename: 'respaldo.md' }), markdown));
    const { container } = renderApp(`/documentos/${ID}`);

    expect(await screen.findByRole('heading', { name: 'Respaldo', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('pg_dump').tagName).toBe('CODE');
    expect(container.querySelector('article script')).toBeNull();
    expect(container.querySelector('article img')).toBeNull();
    // Un enlace javascript: del documento no conserva ese esquema.
    const link = screen.getByText('Ver guía').closest('a');
    expect(link?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });

  it('muestra el TXT como texto preformateado', async () => {
    mockFetch(...routes(detail({ mimeType: 'text/plain', originalFilename: 'notas.txt' }), 'línea 1\n<b>línea 2</b>'));
    const { container } = renderApp(`/documentos/${ID}`);

    const pre = await screen.findByText(/línea 1/);
    expect(pre.tagName).toBe('PRE');
    expect(pre.textContent).toBe('línea 1\n<b>línea 2</b>');
    expect(container.querySelector('pre b')).toBeNull();
  });

  it('muestra la causa en el cajetín de un documento en ERROR', async () => {
    mockFetch(...routes(detail({ status: 'ERROR', contentIndexed: false, errorMessage: 'El PDF está dañado o no se puede leer', indexedAt: null })));
    renderApp(`/documentos/${ID}`);
    expect(await screen.findByText('El PDF está dañado o no se puede leer')).toBeInTheDocument();
  });

  it('actualiza el estado en vivo mientras el documento se procesa (SSE) y recarga el detalle', async () => {
    FakeEventSource.install();
    let calls = 0;
    mockFetch((url) => {
      if (url !== `/api/documents/${ID}`) return undefined;
      calls++;
      return json(calls === 1 ? detail({ status: 'PROCESANDO', contentIndexed: false, indexedAt: null }) : detail());
    });
    renderApp(`/documentos/${ID}`);

    expect(await screen.findByText('Procesando')).toBeInTheDocument();
    const source = FakeEventSource.last;
    expect(source.url).toBe(`/api/events?ids=${ID}`);

    source.emit('status', { id: ID, status: 'INDEXADO', contentIndexed: true, errorMessage: null, updatedAt: '2026-10-28T15:07:31.696Z' });

    expect(await screen.findByText('Indexado')).toBeInTheDocument();
    expect(calls).toBe(2);
    // Ya no se procesa: deja de escuchar.
    expect(source.closed).toBe(true);
  });

  it('informa si el documento no existe', async () => {
    mockFetch((url) => (url.startsWith('/api/documents/') ? json({ statusCode: 404, message: 'Documento no encontrado' }, 404) : undefined));
    renderApp(`/documentos/${ID}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('Documento no encontrado');
  });
});
