import { NavLink, Outlet, Link, useNavigate } from 'react-router';
import { useAuth } from '../features/auth/auth-context';
import { Button } from './Button';
import { buttonClass } from './button-class';

const navLink = ({ isActive }: { isActive: boolean }) =>
  `flex h-14 items-center border-b-2 px-3 font-semibold transition-colors duration-(--duration-fast) ${
    isActive ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink'
  }`;

/** Cabecera fija + contenido. "Cargar" solo existe con sesión de administrador. */
export function Layout() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-20 focus:rounded-(--radius-md) focus:bg-sheet focus:px-4 focus:py-2"
      >
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-10 border-b border-rule bg-sheet shadow-(--shadow-raise)">
        <div className="mx-auto flex max-w-(--page-max) flex-wrap items-center gap-x-6 px-4">
          <Link to="/buscar" className="grid py-2 leading-none text-ink no-underline">
            <b className="font-display text-[17px] leading-5 font-semibold">Documentos técnicos</b>
            <span className="text-[12px] leading-4 text-ink-muted">Buscador y visor</span>
          </Link>
          <nav aria-label="Principal" className="flex flex-1 gap-1">
            <NavLink to="/buscar" className={navLink}>
              Buscar
            </NavLink>
            {session && (
              <NavLink to="/cargar" className={navLink}>
                Cargar
              </NavLink>
            )}
          </nav>
          <div className="flex items-center gap-2 py-2 text-[13px] text-ink-muted">
            {session ? (
              <>
                <span>{session.username}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    logout();
                    navigate('/buscar');
                  }}
                >
                  Cerrar sesión
                </Button>
              </>
            ) : (
              <Link to="/login" className={buttonClass('secondary', 'sm')}>
                Iniciar sesión
              </Link>
            )}
          </div>
        </div>
      </header>
      <main id="contenido" tabIndex={-1} className="mx-auto max-w-(--page-max) px-4 pt-8 pb-12 outline-none">
        <Outlet />
      </main>
    </>
  );
}
