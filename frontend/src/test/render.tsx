import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from '../App';
import { AuthProvider } from '../features/auth/AuthContext';

/** Monta la aplicación completa (rutas + sesión) en una URL dada. */
export function renderApp(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** JWT con la forma real (cabecera.payload.firma); la interfaz solo lee sub y exp. */
export function fakeToken(sub = 'admin', expiresInSeconds = 3600): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + expiresInSeconds })}.firma`;
}

export function signIn() {
  const token = fakeToken();
  sessionStorage.setItem('docs.session', JSON.stringify({ token, username: 'admin', expiresAt: Date.now() + 3_600_000 }));
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

/** Sustituye fetch: cada ruta decide la respuesta; lo no previsto falla la prueba con un mensaje claro. */
export function mockFetch(...routes: Route[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const route of routes) {
      const response = await route(url, init);
      if (response) return response;
    }
    throw new Error(`fetch no previsto en la prueba: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
