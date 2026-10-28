// Cliente de la API. Las rutas son relativas: en desarrollo el proxy de Vite las envía al backend.

export type DocumentStatus = 'PROCESANDO' | 'INDEXADO' | 'ERROR';

export type HighlightSegment = { text: string; match: boolean };

export type SearchItem = {
  id: string;
  title: string;
  titleHighlight: HighlightSegment[];
  snippets: HighlightSegment[][];
  author: string;
  category: string;
  tags: string[];
  version: string;
  mimeType: string;
  originalFilename: string;
  sizeBytes: number;
  contentIndexed: boolean;
  createdAt: string;
  indexedAt: string;
};

export type SearchResponse = { items: SearchItem[]; total: number; page: number; pageSize: number };

export type DocumentDetail = {
  id: string;
  title: string;
  author: string;
  category: string;
  tags: string[];
  version: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  contentIndexed: boolean;
  errorMessage: string | null;
  createdAt: string;
  indexedAt: string | null;
};

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Mensaje legible desde un error de Nest ({ message }) o uno genérico según el código. */
async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  const body = await res.json().catch(() => null);
  const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
  throw new ApiError(message ?? fallbackMessage(res.status), res.status);
}

function fallbackMessage(status: number): string {
  if (status === 404) return 'El documento no existe o fue eliminado.';
  if (status === 429) return 'Demasiados intentos. Espere un minuto y vuelva a intentarlo.';
  return 'No se pudo completar la operación. Compruebe la conexión e inténtelo de nuevo.';
}

export async function login(username: string, password: string) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then(ensureOk);
  return (await res.json()) as { accessToken: string; expiresIn: string };
}

export async function searchDocuments(
  query: string,
  page: number,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ query, page: String(page), pageSize: '10' });
  const res = await fetch(`/api/documents?${params}`, { signal }).then(ensureOk);
  return res.json();
}

export async function getDocument(id: string, signal?: AbortSignal): Promise<DocumentDetail> {
  const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, { signal }).then(ensureOk);
  return res.json();
}

export const originalUrl = (id: string, download = false) =>
  `/api/documents/${encodeURIComponent(id)}/original${download ? '?download=1' : ''}`;

export async function getOriginalText(id: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(originalUrl(id), { signal }).then(ensureOk);
  return res.text();
}
