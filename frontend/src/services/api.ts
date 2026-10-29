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

/** `totalCapped`: hay más coincidencias que `total` (la API cuenta con tope para no recorrerlas todas). */
export type SearchResponse = { items: SearchItem[]; total: number; totalCapped: boolean; page: number; pageSize: number };

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

/** Mensaje legible desde un error de la API ({ message }, texto o lista) o uno genérico según el código. */
async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  const body = await res.json().catch(() => null);
  const message = Array.isArray(body?.message) ? body.message.join(' · ') : body?.message;
  throw new ApiError(message ?? fallbackMessage(res.status), res.status);
}

function fallbackMessage(status: number): string {
  // La API siempre acompaña sus 404 de un mensaje; uno sin cuerpo viene de otro servidor (proxy mal dirigido).
  if (status === 404) return 'El servidor no reconoce esta operación. Compruebe que la API está en marcha y que la interfaz apunta a ella.';
  if (status === 429) return 'Demasiados intentos. Espere un minuto y vuelva a intentarlo.';
  return 'No se pudo completar la operación. Compruebe la conexión e inténtelo de nuevo.';
}

/** fetch con el fallo de red en español ("Failed to fetch" no le dice nada al usuario). */
async function send(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError('No se pudo conectar con el servidor. Compruebe que la API está en marcha e inténtelo de nuevo.', 0);
  }
}

export async function login(username: string, password: string) {
  const res = await send('/api/auth/login', {
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
  const res = await send(`/api/documents?${params}`, { signal }).then(ensureOk);
  return res.json();
}

export async function getDocument(id: string, signal?: AbortSignal): Promise<DocumentDetail> {
  const res = await send(`/api/documents/${encodeURIComponent(id)}`, { signal }).then(ensureOk);
  return res.json();
}

export const originalUrl = (id: string, download = false) =>
  `/api/documents/${encodeURIComponent(id)}/original${download ? '?download=1' : ''}`;

export type UploadLimits = { maxFileBytes: number; maxFiles: number; allowedExtensions: string[] };

export type DocumentMetadata = { title: string; author: string; category: string; tags: string[]; version: string };

export type UploadResult = { filename: string; id: string | null; status: DocumentStatus | null; error: string | null };

/** Evento SSE de /api/events (lo publica el worker al cambiar de estado). */
export type StatusEvent = {
  id: string;
  status: DocumentStatus;
  contentIndexed: boolean;
  errorMessage: string | null;
  updatedAt: string;
};

export async function getUploadLimits(signal?: AbortSignal): Promise<UploadLimits> {
  // JSON (no multipart): la protección CSRF de Apollo no exige cabecera de preflight aquí.
  const res = await send('/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ uploadLimits { maxFileBytes maxFiles allowedExtensions } }' }),
    signal,
  }).then(ensureOk);
  return (await res.json()).data.uploadLimits;
}

const UPLOAD_MUTATION = `mutation Upload($files: [Upload!]!, $input: UploadDocumentsInput!) {
  uploadDocuments(files: $files, input: $input) { filename id status error }
}`;

/**
 * GraphQL multipart request (https://github.com/jaydenseric/graphql-multipart-request-spec):
 * `operations` con null en el lugar de cada archivo, `map` que los enlaza y los archivos como partes.
 * `documents[i]` describe `files[i]`.
 */
export async function uploadDocuments(token: string, files: File[], documents: DocumentMetadata[]): Promise<UploadResult[]> {
  const body = new FormData();
  body.append('operations', JSON.stringify({ query: UPLOAD_MUTATION, variables: { files: files.map(() => null), input: { documents } } }));
  body.append('map', JSON.stringify(Object.fromEntries(files.map((_, i) => [String(i), [`variables.files.${i}`]]))));
  files.forEach((file, i) => body.append(String(i), file, file.name));

  const res = await send('/graphql', {
    method: 'POST',
    // apollo-require-preflight: sin ella Apollo rechaza el multipart (protección CSRF).
    headers: { authorization: `Bearer ${token}`, 'apollo-require-preflight': 'true' },
    body,
  });
  const payload = await res.json().catch(() => null);
  const graphQlError: string | undefined = payload?.errors?.[0]?.message;
  if (!res.ok || !payload?.data) {
    throw new ApiError(graphQlError ?? fallbackMessage(res.status), res.ok ? 400 : res.status);
  }
  return payload.data.uploadDocuments;
}

export async function getOriginalText(id: string, signal?: AbortSignal): Promise<string> {
  const res = await send(originalUrl(id), { signal }).then(ensureOk);
  return res.text();
}
