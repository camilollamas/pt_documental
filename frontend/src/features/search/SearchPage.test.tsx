import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SearchItem } from '../../services/api';
import { json, mockFetch, renderApp } from '../../test/render';

const item = (overrides: Partial<SearchItem> = {}): SearchItem => ({
  id: 'a096138f-d0c8-4d79-862d-2f2f2c347780',
  title: 'Observabilidad',
  titleHighlight: [{ text: 'Observabilidad', match: false }],
  snippets: [[{ text: 'Métricas con ', match: false }, { text: 'Prometheus', match: true }, { text: ' y Grafana', match: false }]],
  author: 'SRE',
  category: 'Guia',
  tags: ['monitoreo'],
  version: '1.0',
  mimeType: 'application/pdf',
  originalFilename: 'manual.pdf',
  sizeBytes: 667,
  contentIndexed: true,
  createdAt: '2026-10-28T15:07:31.568Z',
  indexedAt: '2026-10-28T15:07:31.696Z',
  ...overrides,
});

const searchRoute = (body: object, status = 200) => (url: string) =>
  url.startsWith('/api/documents?') ? json(body, status) : undefined;

describe('Buscar', () => {
  it('sin consulta muestra la ayuda de sintaxis y no llama a la API', () => {
    const fetchMock = mockFetch();
    renderApp('/buscar');
    expect(screen.getByText('"frase exacta"')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('muestra resultados con coincidencias resaltadas, enlace al detalle y total', async () => {
    const fetchMock = mockFetch(searchRoute({ items: [item()], total: 1, page: 1, pageSize: 10 }));
    renderApp('/buscar?q=prometheus');

    const link = await screen.findByRole('link', { name: 'Observabilidad' });
    expect(link).toHaveAttribute('href', '/documentos/a096138f-d0c8-4d79-862d-2f2f2c347780');
    const result = link.closest('li')!;
    expect(within(result).getByText('Prometheus').tagName).toBe('MARK');
    expect(within(result).getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('1–1 de 1 resultado')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/documents?query=prometheus&page=1&pageSize=10', expect.anything());
  });

  it('marca los documentos sin contenido indexado en lugar de mostrar fragmentos', async () => {
    mockFetch(searchRoute({ items: [item({ contentIndexed: false, snippets: [] })], total: 1, page: 1, pageSize: 10 }));
    renderApp('/buscar?q=plano');
    expect(await screen.findByText(/Sin contenido: solo se encontró por título y metadatos/)).toBeInTheDocument();
  });

  it('envía la consulta del formulario y la refleja en la búsqueda', async () => {
    const fetchMock = mockFetch(searchRoute({ items: [], total: 0, page: 1, pageSize: 10 }));
    renderApp('/buscar');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar en los documentos' }), '"pg_dump y restauración"');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText('No hay documentos que contengan «"pg_dump y restauración"».')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/documents?${new URLSearchParams({ query: '"pg_dump y restauración"', page: '1', pageSize: '10' })}`,
    );
  });

  it('pagina con enlaces y marca la página actual', async () => {
    mockFetch(searchRoute({ items: [item()], total: 25, page: 2, pageSize: 10 }));
    renderApp('/buscar?q=guardia&page=2');

    const nav = await screen.findByRole('navigation', { name: 'Paginación de resultados' });
    expect(within(nav).getByText('11–20 de 25 resultados')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: '2' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Página siguiente' })).toHaveAttribute('href', '/buscar?q=guardia&page=3');
  });

  it('muestra un error legible si la búsqueda falla', async () => {
    mockFetch(searchRoute({ statusCode: 500 }, 500));
    renderApp('/buscar?q=algo');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo completar la búsqueda');
  });
});
