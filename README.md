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
| Pruebas | Vitest + Supertest |
| Frontend | React + Vite + Tailwind CSS *(pendiente)* |

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

```bash
npm run start:dev
```

Las **migraciones se aplican solas** al arrancar la API. La API queda en `http://localhost:3000`:

| Ruta | Acceso | Descripción |
|---|---|---|
| `GET /api/health` | Público | Estado del servicio |
| `POST /api/auth/login` | Público | Login del administrador → JWT |
| `POST /graphql` · `uploadDocuments` | **Administrador** | Carga de documentos |
| `POST /graphql` · `uploadLimits` | Público | Límites de carga |

### Variables de entorno (`backend/.env`)

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto de la API |
| `DATABASE_URL` | `postgres://docs:docs_local@localhost:5432/documents` | Conexión a PostgreSQL |
| `TEST_DATABASE_URL` | `postgres://docs:docs_local@localhost:5432/documents_test` | Base de las pruebas e2e (se vacía en cada prueba) |
| `STORAGE_DIR` | `./storage` | Carpeta de los archivos originales (ignorada por Git) |
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

```bash
curl http://localhost:3000/graphql \
  -H "authorization: Bearer $TOKEN" \
  -H "apollo-require-preflight: true" \
  -F operations='{"query":"mutation($files:[Upload!]!,$input:UploadDocumentsInput!){uploadDocuments(files:$files,input:$input){filename id status error}}","variables":{"files":[null],"input":{"documents":[{"title":"Guía de instalación","author":"Equipo Infra","category":"Manual","tags":["servidor","linux"],"version":"1.0"}]}}}' \
  -F map='{"0":["variables.files.0"]}' \
  -F 0=@guia.txt
```

Respuesta inmediata, sin esperar a la indexación:

```json
{ "data": { "uploadDocuments": [
  { "filename": "guia.txt", "id": "1ea1d80d-…", "status": "PROCESANDO", "error": null }
] } }
```

Cada archivo del lote se acepta o se rechaza por separado. Un archivo rechazado trae `id: null` y un `error` legible (formato no admitido, tamaño excedido, contenido que no corresponde a la extensión o archivo vacío).

| Situación | Respuesta |
|---|---|
| Sin token, o token inválido o caducado | HTTP 401 `UNAUTHENTICATED`, antes de recibir los archivos |
| Sin la cabecera `apollo-require-preflight` | HTTP 400 (CSRF) |
| Más archivos que `MAX_FILES_PER_UPLOAD` | HTTP 413 |
| Metadatos inválidos o número de archivos ≠ número de metadatos | `errors[0].extensions.code = "BAD_REQUEST"` |

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
npm run test:e2e    # integración: login, GraphQL multipart y PostgreSQL
npm run lint
```

## Estructura

```text
├── backend/
│   ├── scripts/           # hash-password
│   ├── src/
│   │   ├── auth/          # login del administrador, JWT, guard
│   │   ├── common/        # configuración y health check
│   │   ├── database/      # configuración TypeORM y migraciones SQL
│   │   ├── documents/     # entidad, carga, validación de archivos, DTOs
│   │   └── graphql/       # resolvers GraphQL
│   └── test/              # pruebas e2e
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
| HU-01 | Cola de indexación (BullMQ) y extracción de texto | ⏳ Pendiente |
| HU-02 | Búsqueda full-text paginada con resaltado | ⏳ Pendiente |
| HU-03 | Visor de documentos y detalle | ⏳ Pendiente |
| HU-04 | Notificaciones en tiempo real (SSE) | ⏳ Pendiente |
| — | Frontend | ⏳ Pendiente |
| — | Medición de latencia de búsqueda | ⏳ Pendiente |

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
- Los documentos quedan en `PROCESANDO` hasta que se implemente el worker de indexación.
- PDF escaneados sin capa de texto: no se hará OCR (por definir y documentar).
