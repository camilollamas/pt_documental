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
npm run start:dev
```

Las **migraciones se aplican solas** al arrancar la API. La API queda en `http://localhost:3000`:

| Ruta | Descripción |
|---|---|
| `GET /api/health` | Estado del servicio |
| `POST /graphql` | API GraphQL (carga de documentos) |

### Variables de entorno (`backend/.env`)

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto de la API |
| `DATABASE_URL` | `postgres://docs:docs_local@localhost:5432/documents` | Conexión a PostgreSQL |
| `TEST_DATABASE_URL` | `postgres://docs:docs_local@localhost:5432/documents_test` | Base de las pruebas e2e (se vacía en cada prueba) |
| `STORAGE_DIR` | `./storage` | Carpeta de los archivos originales (ignorada por Git) |
| `MAX_UPLOAD_BYTES` | `10485760` (10 MB) | Tamaño máximo por archivo, inclusivo |
| `MAX_FILES_PER_UPLOAD` | `10` | Máximo de archivos por lote |

## Uso de la API

### Subir documentos

La carga usa el [GraphQL multipart request spec](https://github.com/jaydenseric/graphql-multipart-request-spec). `documents[i]` contiene los metadatos de `files[i]`. Es obligatoria la cabecera `apollo-require-preflight` (protección CSRF).

```bash
curl http://localhost:3000/graphql \
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
npm run test:e2e    # integración: GraphQL multipart + PostgreSQL
npm run lint
```

## Estructura

```text
├── backend/
│   ├── src/
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
| HU-01 | Login de administrador para autorizar la carga | ⏳ Pendiente |
| HU-01 | Cola de indexación (BullMQ) y extracción de texto | ⏳ Pendiente |
| HU-02 | Búsqueda full-text paginada con resaltado | ⏳ Pendiente |
| HU-03 | Visor de documentos y detalle | ⏳ Pendiente |
| HU-04 | Notificaciones en tiempo real (SSE) | ⏳ Pendiente |
| — | Frontend | ⏳ Pendiente |
| — | Medición de latencia de búsqueda | ⏳ Pendiente |

## Alcance: enunciado y aclaraciones posteriores

Además de lo que pide el enunciado de la prueba, se aplican estas aclaraciones recibidas después:

- **Carga por GraphQL multipart.** El enunciado admite REST o GraphQL.
- **Login de un único administrador** (pendiente). Solo el administrador puede subir documentos; la búsqueda y el visor son públicos. No hay registro de usuarios.
- **PDF original embebido** en el visor (pendiente). El texto extraído se usa solo para la búsqueda.
- **Tailwind CSS** en el frontend (pendiente).
- **Límite de 10 MB por archivo**, configurable. El enunciado no fija un valor.

## Limitaciones conocidas

- Por ahora la carga no exige autenticación (llega con el login de administrador).
- Los documentos quedan en `PROCESANDO` hasta que se implemente el worker de indexación.
- PDF escaneados sin capa de texto: no se hará OCR (por definir y documentar).
