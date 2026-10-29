import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeToken, json, mockFetch, renderApp, signIn } from '../../test/render';

const header = () => screen.getByRole('banner');

describe('Sesión del administrador', () => {
  it('sin sesión: la cabecera ofrece "Iniciar sesión" y no muestra "Cargar"', () => {
    mockFetch();
    renderApp('/buscar');
    expect(within(header()).getByRole('link', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(within(header()).queryByRole('link', { name: 'Cargar' })).toBeNull();
  });

  it('sin sesión, /cargar lleva al login', () => {
    mockFetch();
    renderApp('/cargar');
    expect(screen.getByRole('heading', { name: 'Iniciar sesión', level: 1 })).toBeInTheDocument();
  });

  it('con credenciales correctas entra y vuelve a la página que pidió', async () => {
    const fetchMock = mockFetch(
      (url, init) =>
        url === '/api/auth/login' && init?.method === 'POST' ? json({ accessToken: fakeToken('admin'), expiresIn: '8h' }) : undefined,
      (url) => (url === '/graphql' ? json({ data: { uploadLimits: { maxFileBytes: 1024, maxFiles: 3, allowedExtensions: ['.pdf'] } } }) : undefined),
    );
    renderApp('/cargar');

    await userEvent.type(screen.getByLabelText('Usuario'), 'admin');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'clave-correcta');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByRole('heading', { name: 'Cargar documentos', level: 1 })).toBeInTheDocument();
    expect(within(header()).getByRole('link', { name: 'Cargar' })).toHaveAttribute('aria-current', 'page');
    expect(within(header()).getByText('admin')).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ username: 'admin', password: 'clave-correcta' });
  });

  it('muestra un usuario con tildes tal cual (el JWT va en UTF-8)', async () => {
    mockFetch((url) => (url === '/api/auth/login' ? json({ accessToken: fakeToken('josé'), expiresIn: '8h' }) : undefined));
    renderApp('/login');

    await userEvent.type(screen.getByLabelText('Usuario'), 'josé');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'clave');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await within(header()).findByText('josé')).toBeInTheDocument();
  });

  it('con credenciales incorrectas muestra el error de la API', async () => {
    mockFetch((url) => (url === '/api/auth/login' ? json({ statusCode: 401, message: 'Credenciales inválidas' }, 401) : undefined));
    renderApp('/login');

    await userEvent.type(screen.getByLabelText('Usuario'), 'admin');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Credenciales inválidas');
    expect(alert).toHaveTextContent('Revise el usuario y la contraseña');
  });

  it('un 404 sin mensaje (proxy hacia otro servidor) no habla de documentos ni de credenciales', async () => {
    mockFetch((url) => (url === '/api/auth/login' ? new Response('Not Found', { status: 404 }) : undefined));
    renderApp('/login');
    await userEvent.type(screen.getByLabelText('Usuario'), 'admin');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'clave');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('El servidor no reconoce esta operación');
    expect(alert).not.toHaveTextContent('Revise el usuario');
  });

  it('sin conexión con la API muestra un mensaje en español', async () => {
    mockFetch((url) => (url === '/api/auth/login' ? Promise.reject(new TypeError('Failed to fetch')) : undefined));
    renderApp('/login');
    await userEvent.type(screen.getByLabelText('Usuario'), 'admin');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'clave');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor');
  });

  it('cerrar sesión quita "Cargar" y la sesión guardada', async () => {
    signIn();
    mockFetch();
    renderApp('/buscar');

    await userEvent.click(within(header()).getByRole('button', { name: 'Cerrar sesión' }));

    expect(within(header()).queryByRole('link', { name: 'Cargar' })).toBeNull();
    expect(sessionStorage.getItem('docs.session')).toBeNull();
  });
});
