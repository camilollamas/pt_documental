import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeEventSource } from '../../test/fake-event-source';
import { json, mockFetch, renderApp, signIn } from '../../test/render';

const LIMITS = { maxFileBytes: 1024, maxFiles: 3, allowedExtensions: ['.pdf', '.md', '.markdown', '.txt'] };
const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';

const file = (name: string, size = 10) => new File(['x'.repeat(size)], name);
// applyAccept: false → como al arrastrar, donde el navegador NO filtra por `accept`: valida nuestro código.
const user = () => userEvent.setup({ pointerEventsCheck: 0, applyAccept: false });

/** Respuestas de /graphql: límites (JSON) y carga (multipart, FormData). */
function graphql(upload: (body: FormData) => Response = () => json({ data: { uploadDocuments: [] } })) {
  return mockFetch((url, init) => {
    if (url !== '/graphql') return undefined;
    return init?.body instanceof FormData ? upload(init.body) : json({ data: { uploadLimits: LIMITS } });
  });
}

async function addFiles(...files: File[]) {
  await screen.findByText(/por lote/);
  await user().upload(screen.getByTestId('file-input'), files);
}

describe('Cargar documentos', () => {
  beforeEach(() => {
    signIn();
    FakeEventSource.install();
  });

  it('muestra los límites que publica la API', async () => {
    graphql();
    renderApp('/cargar');
    expect(await screen.findByText('PDF, Markdown o TXT · hasta 1 KB por archivo · 3 por lote')).toBeInTheDocument();
  });

  it('rechaza antes de enviar los formatos no admitidos, los vacíos y los que superan el tamaño', async () => {
    graphql();
    renderApp('/cargar');
    await addFiles(file('virus.exe'), file('vacio.txt', 0), file('enorme.pdf', 2048), file('guia.md'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('3 archivos no se añadieron');
    expect(within(alert).getByText('virus.exe').parentElement).toHaveTextContent('Formato no admitido');
    expect(within(alert).getByText('vacio.txt').parentElement).toHaveTextContent('El archivo está vacío');
    expect(within(alert).getByText('enorme.pdf').parentElement).toHaveTextContent('Supera el máximo de 1 KB');
    // El válido queda listo para editar, con el título tomado del nombre.
    expect(screen.getByDisplayValue('guia')).toBeInTheDocument();
  });

  it('acepta archivos arrastrados y respeta el máximo por lote', async () => {
    graphql();
    renderApp('/cargar');
    const zone = (await screen.findByText('Arrastre los archivos aquí')).parentElement!;

    fireEvent.drop(zone, { dataTransfer: { files: [file('a.txt'), file('b.txt'), file('c.txt'), file('d.txt')] } });

    expect(await screen.findByRole('button', { name: 'Subir 3 documentos' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Supera el máximo de 3 archivos por lote');
  });

  it('exige los datos obligatorios sin llamar a la API', async () => {
    const fetchMock = graphql();
    renderApp('/cargar');
    await addFiles(file('guia.md'));

    await user().click(screen.getByRole('button', { name: 'Subir documento' }));

    expect(await screen.findAllByText('Este dato es obligatorio.')).toHaveLength(2); // autor y categoría
    expect(fetchMock.mock.calls.filter(([, init]) => init?.body instanceof FormData)).toHaveLength(0);
  });

  it('sube el lote por GraphQL multipart y actualiza cada fila en vivo por SSE', async () => {
    let sentBody: FormData | undefined;
    const fetchMock = graphql((body) => {
      sentBody = body;
      return json({
        data: {
          uploadDocuments: [
            { filename: 'observabilidad.pdf', id: ID_1, status: 'PROCESANDO', error: null },
            { filename: 'roto.pdf', id: ID_2, status: 'PROCESANDO', error: null },
          ],
        },
      });
    });
    renderApp('/cargar');
    await addFiles(file('observabilidad.pdf'), file('roto.pdf'));

    const u = user();
    await u.type(screen.getByLabelText('Autor'), 'Equipo SRE');
    await u.type(screen.getByLabelText('Categoría'), 'Guía');
    await u.type(screen.getAllByLabelText(/^Etiquetas/)[0], 'monitoreo{Enter}');
    await u.click(screen.getByRole('button', { name: 'Subir 2 documentos' }));

    // Petición: multipart según la especificación, con token y cabecera anti-CSRF.
    await screen.findByText('2 documentos en proceso');
    const init = fetchMock.mock.calls.find(([, i]) => i?.body instanceof FormData)![1]!;
    expect(init.headers).toMatchObject({ authorization: expect.stringMatching(/^Bearer /), 'apollo-require-preflight': 'true' });
    const operations = JSON.parse(String(sentBody!.get('operations')));
    expect(operations.variables.files).toEqual([null, null]);
    expect(operations.variables.input.documents[0]).toEqual({
      title: 'observabilidad',
      author: 'Equipo SRE',
      category: 'Guía',
      tags: ['monitoreo'],
      version: '1.0',
    });
    expect(JSON.parse(String(sentBody!.get('map')))).toEqual({ 0: ['variables.files.0'], 1: ['variables.files.1'] });
    expect((sentBody!.get('1') as File).name).toBe('roto.pdf');

    // Estado en vivo: una sola conexión SSE que sigue los dos documentos.
    const source = FakeEventSource.last;
    expect(source.url).toBe(`/api/events?ids=${[ID_1, ID_2].sort().join(',')}`);
    expect(screen.getAllByText('Procesando')).toHaveLength(2);

    source.emit('status', { id: ID_1, status: 'INDEXADO', contentIndexed: true, errorMessage: null, updatedAt: '2026-10-28T10:00:01Z' });
    source.emit('status', { id: ID_2, status: 'ERROR', contentIndexed: false, errorMessage: 'El PDF está dañado o no se puede leer', updatedAt: '2026-10-28T10:00:02Z' });

    expect(await screen.findByText('Lote procesado')).toBeInTheDocument();
    expect(screen.getByText(/1 de 2 documentos listos para buscar/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'observabilidad' })).toHaveAttribute('href', `/documentos/${ID_1}`);
    expect(screen.getByText('El PDF está dañado o no se puede leer')).toBeInTheDocument();
    // Anuncio para lectores de pantalla del último cambio.
    expect(screen.getByText('roto: error')).toBeInTheDocument();
  });

  it('muestra los archivos que el servidor rechazó, con su motivo', async () => {
    graphql(() =>
      json({ data: { uploadDocuments: [{ filename: 'falso.pdf', id: null, status: null, error: 'El contenido del archivo no corresponde a su extensión' }] } }),
    );
    renderApp('/cargar');
    await addFiles(file('falso.pdf'));
    const u = user();
    await u.type(screen.getByLabelText('Autor'), 'QA');
    await u.type(screen.getByLabelText('Categoría'), 'Prueba');
    await u.click(screen.getByRole('button', { name: 'Subir documento' }));

    expect(await screen.findByText('El contenido del archivo no corresponde a su extensión')).toBeInTheDocument();
    expect(screen.getByText('Lote procesado')).toBeInTheDocument();
  });

  it('con la sesión caducada (401) vuelve al login y lo explica', async () => {
    graphql(() => json({ errors: [{ message: 'Se requiere iniciar sesión como administrador', extensions: { code: 'UNAUTHENTICATED' } }] }, 401));
    renderApp('/cargar');
    await addFiles(file('guia.md'));
    const u = user();
    await u.type(screen.getByLabelText('Autor'), 'QA');
    await u.type(screen.getByLabelText('Categoría'), 'Prueba');
    await u.click(screen.getByRole('button', { name: 'Subir documento' }));

    expect(await screen.findByText('La sesión caducó')).toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem('docs.session')).toBeNull());
  });
});
