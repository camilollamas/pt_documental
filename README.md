# Buscador y Visor de Documentos Técnicos

Aplicación web para cargar documentos técnicos (TXT, PDF y Markdown) con metadatos, indexarlos en segundo plano y buscarlos con Full-Text Search. Las búsquedas devuelven resultados paginados, ordenados por relevancia y con fragmentos resaltados; cada documento se puede abrir en un visor. El cambio de estado de indexación llega a la interfaz en tiempo real.

> **Estado del proyecto:** en desarrollo por bloques. La sección [Estado](#estado) indica qué funciona hoy.

- Arquitectura y decisiones técnicas: [docs/architecture.md](docs/architecture.md)
- Uso de IA durante el desarrollo: [docs/ia.md](docs/ia.md)

## Stack

| Capa | Tecnología |
|---|---|
| Backend | NestJS 12 (TypeScript, ESM) |
| API de carga | GraphQL (Apollo Server 5) con *multipart request* |
| Persistencia y búsqueda | PostgreSQL 18 · Full-Text Search (`tsvector` + índice GIN) · TypeORM 1.1 |
| Cola y eventos | Redis 8 (BullMQ y Pub/Sub) |
| Frontend | React 19 + Vite 8 + Tailwind CSS 4 · React Router 8 · react-markdown · iconos Lucide |
| Sistema de diseño | [Cajetín](https://claude.ai/artifact/9Wc2oqqftyyNDqfeHxxv1t): tokens claro/oscuro verificados WCAG AA |
| Pruebas | Vitest + Supertest (backend) · Vitest + Testing Library (frontend) |

## Requisitos previos

- **Node.js 22.13 o superior** (se recomienda 22.22.3+; con versiones anteriores, el generador `nest g` muestra un aviso de motor que no afecta a la ejecución).
- **npm 11.** Con npm 10 la instalación falla por un bug al resolver dependencias. Si tienes npm 10, usa `npx npm@11 install` en lugar de `npm install`.
- **Docker** con Docker Compose v2 o superior.

## Puesta en marcha

### 1. Infraestructura

```bash
docker compose up -d
```

Levanta PostgreSQL (`localhost:5432`) y Redis (`localhost:6379`) y espera a que estén sanos (`docker compose ps`). La primera vez también se crea la base `documents_test`, que usan las pruebas.

### 2. Backend

```bash
cd backend
cp .env.example .env
npx npm@11 install
```

Configura el administrador en `backend/.env`. Sin estos valores la API no arranca:

```bash
npm run hash-password      # pide la contraseña (mín. 12 caracteres) sin mostrarla
                           # → copia la línea ADMIN_PASSWORD_HASH='...' en .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
                           # → úsalo como JWT_SECRET en .env
```

Arranca la API y el worker de indexación en **dos terminales**:

```bash
npm run start:dev          # API
npm run start:worker:dev   # worker: extrae el texto e indexa en segundo plano
```

Las **migraciones se aplican solas** al arrancar la API. El worker, al arrancar, vuelve a encolar los documentos que hayan quedado en `PROCESANDO`.

En producción: `npm run build`, y después `npm run start:prod` y `npm run start:worker`. La API queda en `http://localhost:3000`:

| Ruta | Acceso | Descripción |
|---|---|---|
| `GET /api/health` | Público | Estado del servicio |
| `POST /api/auth/login` | Público | Login del administrador → JWT |
| `POST /graphql` · `uploadDocuments` | **Administrador** | Carga de documentos |
| `POST /graphql` · `uploadLimits` | Público | Límites de carga |
| `GET /api/documents?query=&page=&pageSize=` | Público | Búsqueda full-text paginada, por relevancia y con fragmentos resaltados |
| `GET /api/documents/:id` | Público | Metadatos y estado del documento |
| `GET /api/documents/:id/status` | Público | Estado actual (`PROCESANDO` / `INDEXADO` / `ERROR`) |
| `GET /api/documents/:id/original` | Público | Archivo original para verlo en el navegador (`?download=1` para descargarlo) |
| `GET /api/events?ids=` | Público | Flujo SSE de cambios de estado (`INDEXADO` / `ERROR`), sin polling |

### 3. Frontend

```bash
cd frontend
npx npm@11 install
npm run dev                 # http://localhost:5173
```

Vite reenvía `/api` y `/graphql` a la API (proxy), así que el navegador habla con un solo origen: sin CORS, y el SSE y el token pasan sin configuración extra.

**Si el puerto 3000 está ocupado** por otra aplicación, arranque la API en otro puerto y diga a Vite dónde está:

```bash
# backend/.env → PORT=3100
API_URL=http://localhost:3100 npm run dev     # PowerShell: $env:API_URL="http://localhost:3100"; npm run dev
```

| Pantalla | Ruta | Acceso |
|---|---|---|
| Buscar | `/buscar?q=&page=` | Público. La consulta vive en la URL: se puede compartir y recargar |
| Detalle y visor | `/documentos/:id` | Público. PDF original embebido; Markdown renderizado; TXT preformateado |
| Iniciar sesión | `/login` | Público (solo existe el administrador) |
| Cargar | `/cargar` | Administrador; sin sesión redirige al login. Arrastrar y soltar o elegir archivos, metadatos por lote y por archivo, estado en vivo por SSE |

### Variables de entorno (`backend/.env`)

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto de la API |
| `DATABASE_URL` | `postgres://docs:docs_local@localhost:5432/documents` | Conexión a PostgreSQL |
| `TEST_DATABASE_URL` | `postgres://docs:docs_local@localhost:5432/documents_test` | Base de las pruebas e2e (se vacía en cada prueba) |
| `REDIS_URL` | `redis://localhost:6379` | Redis de la cola de indexación |
| `TEST_REDIS_URL` | `redis://localhost:6379/1` | Base Redis de las pruebas e2e |
| `INDEXING_CONCURRENCY` | `2` | Documentos indexados en paralelo por worker |
| `EVENTS_CHANNEL` | `document-status` | Canal Redis Pub/Sub de los cambios de estado. La API y el worker deben usar el mismo |
| `SEARCH_COUNT_CAP` | `1000` | Tope del conteo de resultados: por encima, la API responde `totalCapped: true` ("más de 1000 resultados") |
| `STORAGE_DIR` | `./storage` | Carpeta de los archivos originales (ignorada por Git). La API y el worker deben apuntar a la misma |
| `MAX_UPLOAD_BYTES` | `10485760` (10 MB) | Tamaño máximo por archivo, inclusivo |
| `MAX_FILES_PER_UPLOAD` | `10` | Máximo de archivos por lote |
| `ADMIN_USERNAME` | `admin` | Usuario del administrador único |
| `ADMIN_PASSWORD_HASH` | — (**obligatorio**) | Hash bcrypt generado con `npm run hash-password` |
| `JWT_SECRET` | — (**obligatorio**, ≥ 32 caracteres) | Secreto de firma de los tokens |
| `JWT_EXPIRES_IN` | `8h` | Duración del token |
| `LOGIN_MAX_ATTEMPTS_PER_MINUTE` | `5` | Intentos de login por IP y minuto (después responde 429) |

## Uso de la API

### Iniciar sesión (administrador)

```bash
curl http://localhost:3000/api/auth/login -H "content-type: application/json" \
  -d '{"username":"admin","password":"<tu contraseña>"}'
# → {"accessToken":"eyJhbGciOi…","expiresIn":"8h"}
```

Las credenciales incorrectas devuelven `401 Credenciales inválidas`, con el mismo mensaje tanto si falla el usuario como la contraseña. Al superar los intentos por minuto responde `429`. No hay registro de usuarios.

### Subir documentos (requiere token)

La carga usa el [GraphQL multipart request spec](https://github.com/jaydenseric/graphql-multipart-request-spec). `documents[i]` contiene los metadatos de `files[i]`. Son obligatorias dos cabeceras: `Authorization: Bearer <token>` y `apollo-require-preflight` (protección CSRF).

Guarde la operación en un archivo UTF-8, `operations.json`:

```json
{"query":"mutation($files:[Upload!]!,$input:UploadDocumentsInput!){uploadDocuments(files:$files,input:$input){filename id status error}}","variables":{"files":[null],"input":{"documents":[{"title":"Guía de instalación","author":"Equipo Infra","category":"Manual","tags":["servidor","linux"],"version":"1.0"}]}}}
```

```bash
curl http://localhost:3000/graphql \
  -H "authorization: Bearer $TOKEN" \
  -H "apollo-require-preflight: true" \
  -F "operations=<operations.json" \
  -F map='{"0":["variables.files.0"]}' \
  -F 0=@guia.txt
```

> **Por qué un archivo:** en Windows, `curl` convierte los argumentos de la línea de comandos a la página de códigos del sistema, así que las tildes de un JSON escrito en el propio comando llegan dañadas (`Gu�a`). Con `<operations.json`, `curl` envía el archivo tal cual. La API rechaza los metadatos con `�` (texto en otra codificación) para no guardarlos dañados. La interfaz web no tiene este problema.

Respuesta inmediata, sin esperar a la indexación:

```json
{ "data": { "uploadDocuments": [
  { "filename": "guia.txt", "id": "1ea1d80d-…", "status": "PROCESANDO", "error": null }
] } }
```

Después, el worker extrae el texto y el documento pasa a uno de estos estados:
- **`INDEXADO`**: ya se puede buscar.
- **`ERROR`**: con la causa en `error_message` (PDF dañado o protegido, archivo no disponible o demasiado texto para el índice).

Los documentos **sin texto extraíble** (PDF escaneado, archivo en blanco) se indexan igual por título y metadatos y quedan marcados con `content_indexed = false`.

Cada archivo del lote se acepta o se rechaza por separado. Un archivo rechazado trae `id: null` y un `error` legible (formato no admitido, tamaño excedido, contenido que no corresponde a la extensión o archivo vacío).

| Situación | Respuesta |
|---|---|
| Sin token, o token inválido o caducado | HTTP 401 `UNAUTHENTICATED`, antes de recibir los archivos |
| Sin la cabecera `apollo-require-preflight` | HTTP 400 (CSRF) |
| Más archivos que `MAX_FILES_PER_UPLOAD` | HTTP 413 |
| Metadatos inválidos o número de archivos ≠ número de metadatos | `errors[0].message` en español (p. ej. "Documento 1 · título: admite como máximo 200 caracteres") y `extensions: { code: "BAD_REQUEST", details: [...] }` con un error por campo |

### Buscar

```bash
curl "http://localhost:3000/api/documents?query=prometheus&page=1&pageSize=10"
```

```json
{
  "items": [{
    "id": "a096138f-…", "title": "Observabilidad",
    "titleHighlight": [{ "text": "Observabilidad", "match": false }],
    "snippets": [[
      { "text": "Métricas con ", "match": false },
      { "text": "Prometheus", "match": true },
      { "text": " y Grafana", "match": false }
    ]],
    "author": "SRE", "category": "Guia", "tags": ["monitoreo"], "version": "1.0",
    "mimeType": "application/pdf", "contentIndexed": true, "rank": 0.2, "…": "…"
  }],
  "total": 1, "totalCapped": false, "page": 1, "pageSize": 10
}
```

Sintaxis de `query`, la misma de los buscadores web (`websearch_to_tsquery`):

| Ejemplo | Significado |
|---|---|
| `nginx proxy` | Ambos términos |
| `"instalación del servidor"` | Frase exacta |
| `grafana or kibana` | Cualquiera de los dos |
| `servidor -correo` | Excluye el término |

- Busca en el título, los metadatos (autor, categoría, versión y etiquetas) y el **contenido extraído**. Una coincidencia en el título pesa más que en los metadatos, y esta más que en el contenido.
- Una búsqueda vacía, sin resultados o compuesta solo de signos devuelve `items: []` sin error. `pageSize` va de 1 a 50 (por defecto 10) y `query` admite hasta 200 caracteres.
- Las coincidencias se devuelven como **segmentos** `{ text, match }`, no como HTML, para que el cliente las pinte sin riesgo de XSS.
- La cabecera `Server-Timing: db;dur=…` indica el tiempo de la consulta en la base de datos.
- Solo aparecen documentos `INDEXADO`. Los que tienen `contentIndexed: false` se encuentran solo por título y metadatos, y no tienen fragmentos.

### Detalle y archivo original

```bash
curl http://localhost:3000/api/documents/<id>            # metadatos y estado
curl -I http://localhost:3000/api/documents/<id>/original
# Content-Type: application/pdf
# Content-Disposition: inline; filename="manual.pdf"; filename*=UTF-8''manual.pdf
# X-Content-Type-Options: nosniff
# Accept-Ranges: bytes
```

El original se sirve `inline` para mostrarlo embebido (PDF en el visor del navegador; MD y TXT como texto UTF-8). Admite peticiones parciales (`Range`) y `?download=1` para descargarlo. La API nunca expone la ruta física del archivo.

### Notificaciones en tiempo real (SSE)

```bash
curl -N "http://localhost:3000/api/events?ids=<id1>,<id2>"
```

```text
event: ready
retry: 3000
data: {"following":["e1a01fcb-…"]}

event: status
data: {"id":"e1a01fcb-…","status":"PROCESANDO","contentIndexed":false,"errorMessage":null,"updatedAt":"…"}

event: status
data: {"id":"e1a01fcb-…","status":"INDEXADO","contentIndexed":true,"errorMessage":null,"updatedAt":"…"}
```

- Al conectar se envía el **estado actual** de los `ids` seguidos (hasta 50). Después llegan los cambios en vivo, publicados por el worker.
- Sin `ids` se reciben los cambios de todos los documentos.
- `EventSource` se reconecta solo (`retry: 3000`) y en cada reconexión vuelve a recibir el estado actual, así que no se pierde ningún cambio ocurrido durante el corte.
- Si el estado actual y un evento en vivo llegan cruzados, hay que quedarse con el de `updatedAt` más reciente.

```js
const events = new EventSource(`/api/events?ids=${ids.join(',')}`);
events.addEventListener('status', (e) => actualizarEstado(JSON.parse(e.data)));
```

### Consultar los límites de carga

```bash
curl http://localhost:3000/graphql -H "content-type: application/json" \
  -d '{"query":"{ uploadLimits { maxFileBytes maxFiles allowedExtensions } }"}'
```

## Pruebas

Requieren `docker compose up -d`, porque las e2e usan PostgreSQL real.

```bash
cd backend
npm test            # unitarias
npm run test:e2e    # integración: login, carga, cola y worker, búsqueda, detalle, original y SSE
npm run lint

cd ../frontend
npm test            # componentes y pantallas (Testing Library, fetch simulado)
npm run lint
npm run build       # comprobación de tipos + build de producción
```

## Datos de prueba y medición de la búsqueda

Con la API y el worker en marcha, y el backend compilado (`npm run build`: la siembra reutiliza la conexión a Redis de `dist/`):

```bash
cd backend
npm run seed                    # 10 000 documentos técnicos sintéticos (SEED_COUNT para cambiar la cantidad)
npm run build && npm run benchmark   # latencia HTTP p50/p95, Server-Timing, 10 clientes y EXPLAIN → docs/benchmark.md
npm run seed -- --clean         # borra los documentos sembrados (etiqueta "semilla")
```

- La siembra genera texto reproducible (semilla fija) y lo indexa **por el pipeline real**: filas en `PROCESANDO`, archivos en `STORAGE_DIR` y trabajos en la cola.
- El benchmark mide la consulta **exacta** de la API y escribe el informe con el hardware y el corpus.
- Resultado registrado: [docs/benchmark.md](docs/benchmark.md). Diagnóstico y optimización: [docs/architecture.md](docs/architecture.md) → "Latencia: medición y optimización".
- Tras una carga masiva conviene ejecutar `VACUUM ANALYZE documents;`: actualiza las estadísticas y vacía la lista pendiente del índice GIN.

## Estructura

```text
├── backend/
│   ├── scripts/           # hash-password
│   ├── src/
│   │   ├── auth/          # login del administrador, JWT, guard
│   │   ├── common/        # configuración y health check
│   │   ├── database/      # configuración TypeORM y migraciones SQL
│   │   ├── documents/     # entidad, carga, detalle, original, validación de archivos, DTOs
│   │   ├── events/        # Redis Pub/Sub (worker → API) y flujo SSE
│   │   ├── graphql/       # resolvers GraphQL
│   │   ├── indexing/      # cola BullMQ, worker, extracción de texto e indexación
│   │   ├── search/        # consulta full-text, ranking y resaltado
│   │   ├── main.ts        # entrada de la API
│   │   └── worker.ts      # entrada del worker
│   └── test/              # pruebas e2e
├── frontend/
│   └── src/
│       ├── components/    # Button, Field, Alert, distintivos, Highlight, Layout (Cajetín)
│       ├── features/
│       │   ├── auth/      # sesión del administrador, login, ruta protegida
│       │   ├── documents/ # detalle: cajetín y visor
│       │   ├── events/    # estado en vivo por SSE (useDocumentStatuses)
│       │   ├── search/    # búsqueda y paginación
│       │   └── upload/    # carga: zona de arrastre, validación y resultados en vivo
│       ├── lib/           # formatos (tamaños, fechas)
│       ├── services/      # cliente de la API
│       └── styles/        # tokens del sistema de diseño Cajetín
├── docker/postgres/init/  # script que crea la base de pruebas
├── docs/
│   ├── architecture.md
│   └── ia.md
└── docker-compose.yml
```

## Estado

| Historia | Funcionalidad | Estado |
|---|---|---|
| HU-01 | Carga individual y por lote con metadatos, validaciones y respuesta inmediata `PROCESANDO` | ✅ Implementada |
| HU-01 | Persistencia en PostgreSQL | ✅ Implementada |
| HU-01 | Login de administrador para autorizar la carga | ✅ Implementada |
| HU-01 | Cola de indexación (BullMQ) y extracción de texto TXT/MD/PDF | ✅ Implementada |
| HU-02 | Búsqueda full-text paginada con resaltado (API) | ✅ Implementada |
| HU-03 | Detalle y archivo original para el visor (API) | ✅ Implementada |
| HU-02 | Búsqueda en la interfaz (resaltado, paginación, URL compartible) | ✅ Implementada |
| HU-03 | Visor en la interfaz (cajetín, PDF original embebido, Markdown y TXT) | ✅ Implementada |
| — | Login del administrador en la interfaz | ✅ Implementado |
| HU-01 | Carga en la interfaz (arrastrar y soltar, metadatos, validación con los límites de la API) | ✅ Implementada |
| HU-04 | Notificaciones en tiempo real (SSE + Redis Pub/Sub, sin polling) (API) | ✅ Implementada |
| HU-04 | Actualización reactiva en la interfaz (carga y detalle, sin polling) | ✅ Implementada |
| — | Medición de latencia de búsqueda con 10 000 documentos ([docs/benchmark.md](docs/benchmark.md)) | ✅ p95 371 ms (un cliente) · 778 ms (10 clientes) |

## Alcance: enunciado y aclaraciones posteriores

Además de lo que pide el enunciado de la prueba, se aplican estas aclaraciones recibidas después:

- **Carga por GraphQL multipart.** El enunciado admite REST o GraphQL.
- **Login de un único administrador.** Solo el administrador puede subir documentos; la búsqueda y el visor son públicos. No hay registro de usuarios, recuperación de contraseña ni roles.
- **PDF original embebido** en el visor (pendiente). El texto extraído se usa solo para la búsqueda.
- **Tailwind CSS** en el frontend (pendiente).
- **Límite de 10 MB por archivo**, configurable. El enunciado no fija un valor.

## Limitaciones conocidas

- El límite de intentos de login se cuenta en memoria por instancia. Con varias réplicas habría que guardarlo en Redis.
- No hay revocación de tokens: un JWT es válido hasta que caduca (8 h). Cambiar `JWT_SECRET` invalida todos.
- **Sin OCR:** un PDF escaneado sin capa de texto se encuentra solo por título y metadatos (`content_indexed = false`).
- Un documento con demasiadas palabras distintas (más de 1 MB de índice, el límite de PostgreSQL para un `tsvector`) termina en `ERROR`. Un texto técnico realista de 10 MB cabe sin problema.
- El Markdown se indexa como texto: los símbolos de formato no generan términos de búsqueda.
- Los fragmentos resaltados se calculan sobre los primeros 50 000 caracteres de cada documento. Una coincidencia posterior encuentra el documento, pero su fragmento muestra el inicio sin resaltar.
- Diccionario `simple` (sin *stemming*): `documento` no encuentra `documentos`.
