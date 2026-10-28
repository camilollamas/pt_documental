import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { login as loginRequest } from '../../services/api';
import { AuthContext, type Session } from './auth-context';

const STORAGE_KEY = 'docs.session';

/**
 * El JWT se guarda en sessionStorage: sobrevive a recargar la pestaña y se borra al cerrarla.
 * Riesgo asumido: un XSS podría leerlo. Se mitiga no insertando nunca HTML sin sanear (ver Highlight).
 */
function readSession(): Session | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as Session | null;
    return saved && saved.expiresAt > Date.now() ? saved : null;
  } catch {
    return null;
  }
}

/** Solo se leen `exp` y `sub` para la interfaz; la validez real la decide la API en cada petición. */
function decodeToken(token: string): { sub: string; exp: number } {
  const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(payload));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readSession);

  const login = useCallback(async (username: string, password: string) => {
    const { accessToken } = await loginRequest(username, password);
    const { sub, exp } = decodeToken(accessToken);
    const next = { token: accessToken, username: sub, expiresAt: exp * 1000 };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, login, logout }), [session, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
