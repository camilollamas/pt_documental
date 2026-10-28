import { Navigate, Route, Routes } from 'react-router';
import { Alert } from './components/Alert';
import { Layout } from './components/Layout';
import { LoginPage } from './features/auth/LoginPage';
import { RequireAdmin } from './features/auth/RequireAdmin';
import { DocumentPage } from './features/documents/DocumentPage';
import { SearchPage } from './features/search/SearchPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/buscar" replace />} />
        <Route path="buscar" element={<SearchPage />} />
        <Route path="documentos/:id" element={<DocumentPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route
          path="cargar"
          element={
            <RequireAdmin>
              {/* Bloque 5b: carga con arrastrar y soltar y estados en vivo. */}
              <Alert tone="info" title="Carga de documentos">
                La interfaz de carga se incorpora en la siguiente entrega.
              </Alert>
            </RequireAdmin>
          }
        />
        <Route path="*" element={<Alert tone="warning" title="Página no encontrada">Revise la dirección o vuelva a Buscar.</Alert>} />
      </Route>
    </Routes>
  );
}
