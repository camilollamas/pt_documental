import { createContext, useContext } from 'react';

export type Session = { token: string; username: string; expiresAt: number };

export type AuthValue = {
  session: Session | null;
  /** La sesión terminó porque la API rechazó el token (401), no porque el usuario saliera. */
  expired: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  expire: () => void;
};

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return value;
}
