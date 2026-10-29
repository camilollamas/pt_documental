import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { ApiError } from '../../services/api';
import { useAuth } from './auth-context';

/** Login del administrador único. No hay registro ni recuperación de contraseña. */
export function LoginPage() {
  const { session, expired, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // Vuelve a la página protegida que pidió el login (p. ej. /cargar).
  const from = (location.state as { from?: string } | null)?.from ?? '/cargar';
  if (session) return <Navigate to={from} replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await login(String(form.get('username')), String(form.get('password')));
      navigate(from, { replace: true });
    } catch (err) {
      setError({ message: (err as Error).message, status: err instanceof ApiError ? err.status : 0 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto grid max-w-sm gap-6">
      <div className="grid gap-1">
        <h1 className="font-display text-[32px] leading-[38px] font-semibold tracking-[-0.01em]">Iniciar sesión</h1>
        <p className="text-ink-muted">Acceso del administrador para subir documentos. La búsqueda no requiere sesión.</p>
      </div>
      {expired && !error && (
        <Alert tone="warning" title="La sesión caducó">
          Inicie sesión de nuevo para subir los documentos. Los archivos elegidos no se enviaron.
        </Alert>
      )}
      {error && (
        <Alert tone="error" title={error.message}>
          {/* La pista solo tiene sentido si el problema son las credenciales. */}
          {error.status === 401 && 'Revise el usuario y la contraseña. Tras 5 intentos fallidos deberá esperar un minuto.'}
        </Alert>
      )}
      <form onSubmit={onSubmit} className="grid gap-4">
        <Field label="Usuario" name="username" autoComplete="username" required maxLength={100} />
        <Field label="Contraseña" name="password" type="password" autoComplete="current-password" required maxLength={200} />
        <Button type="submit" variant="primary" busy={busy}>
          {busy ? 'Iniciando sesión…' : 'Iniciar sesión'}
        </Button>
      </form>
    </section>
  );
}
