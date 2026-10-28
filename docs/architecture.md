# Arquitectura

> Documento vivo: se actualiza al cerrar cada bloque. Las secciones marcadas *(pendiente)* describen el diseño previsto y todavía no están implementadas.

## 1. Diagrama de arquitectura y flujo

```mermaid
flowchart LR
    subgraph Cliente
        UI["Frontend · React + Vite + Tailwind ✅<br/>buscar · visor · login · cargar · estado en vivo"]
    end

    subgraph API["Backend · NestJS"]
        GQL["GraphQL /graphql<br/>uploadDocuments ✅"]
        REST["REST /api<br/>health ✅ · auth/login ✅<br/>búsqueda ✅ · detalle ✅ · original ✅ · status ✅"]
        SSE["SSE /api/events ✅<br/>snapshot + eventos en vivo"]
    end

    subgraph Datos
        PG[("PostgreSQL 18<br/>documents + GIN ✅")]
        FS[("STORAGE_DIR<br/>originales ✅")]
        RQ[("Redis 8<br/>cola BullMQ ✅ · Pub/Sub ✅")]
    end

    W["Worker de indexación ✅<br/>proceso separado"]

    UI -- "multipart (archivos + metadatos)" --> GQL
    UI -- "login / búsqueda / detalle / original" --> REST
    UI -- "EventSource ?ids=" --> SSE
    GQL --> FS
    GQL -- "INSERT PROCESANDO" --> PG
    GQL -- "encola documentId" --> RQ
    RQ -- "trabajo" --> W
    W -- "lee original" --> FS
    W -- "UPDATE texto + tsvector + INDEXADO/ERROR" --> PG
    W -- "PUBLISH cambio de estado" --> RQ
    RQ -- "SUBSCRIBE (1 por instancia)" --> SSE
    SSE -- "snapshot al conectar" --> PG
    REST -- "@@ tsquery (FTS)" --> PG
    REST -- "sendFile inline" --> FS
```

Líneas continuas: implementado. Líneas punteadas: pendiente.

### Flujo de carga (HU-01)

1. ✅ El administrador inicia sesión (`POST /api/auth/login`) y obtiene un JWT de 8 h.
2. ✅ Un middleware rechaza con 401 cualquier petición multipart a `/graphql` sin un Bearer válido, **antes** de leer los archivos.
3. ✅ El cliente envía la mutación `uploadDocuments(files, input)` como `multipart/form-data`. `input.documents[i]` contiene los metadatos de `files[i]`.
4. ✅ El middleware `graphql-upload` interpreta el multipart y aplica `MAX_UPLOAD_BYTES` y `MAX_FILES_PER_UPLOAD`. Apollo rechaza la petición sin la cabecera de preflight (CSRF).
5. ✅ `GqlAuthGuard` vuelve a verificar el token en el resolver, y `ValidationPipe` valida y normaliza los metadatos.
6. ✅ Por cada archivo:
   1. Se valida la extensión.
   2. Se guarda por streaming con un UUID como nombre.
   3. Se verifica que el contenido corresponda a la extensión.
   4. Se inserta la fila `PROCESANDO`.
7. ✅ Se encola el `documentId` en BullMQ (`jobId = documentId`).
8. ✅ La respuesta devuelve `id` + `PROCESANDO` por archivo, sin esperar a la indexación.
9. ✅ El worker (proceso separado) toma el trabajo, lee el original, extrae el texto y, en un solo `UPDATE`, guarda el texto y el `search_vector` y cambia el estado a `INDEXADO`. Ante un fallo del propio documento, el estado pasa a `ERROR` con su causa.
10. ✅ El worker publica el cambio de estado en Redis Pub/Sub (con los datos de `UPDATE … RETURNING`), y cada instancia de la API lo reenvía por SSE a los clientes que siguen ese documento.

### Flujo de búsqueda y visor (HU-02, HU-03)

1. `GET /api/documents?query=…&page=…&pageSize=…` → `ValidationPipe` (query ≤ 200 caracteres, página ≤ 1000, tamaño ≤ 50).
2. Una sola consulta SQL parametrizada:
   1. la CTE `page` filtra `status = 'INDEXADO' AND search_vector @@ websearch_to_tsquery('simple', $1)` con el índice GIN;
   2. ordena por `ts_rank DESC, created_at DESC, id DESC` y aplica `LIMIT/OFFSET`; en paralelo, cuenta las coincidencias con un tope de 1 000 (`totalCapped`);
   3. aplica `LIMIT/OFFSET`;
   4. **solo para las filas de la página** calcula `ts_headline` del título y del contenido.
3. Los marcadores de `ts_headline` (caracteres de control) se convierten en segmentos `{ text, match }`.
4. Detalle: `GET /api/documents/:id` (metadatos y estado). Visor: `GET /api/documents/:id/original` sirve el archivo `inline` con su tipo real.

### Responsabilidad de los módulos

| Módulo | Responsabilidad | Estado |
|---|---|---|
| `common/` | Configuración desde el entorno, health check, almacenamiento de originales (`FileStorage`), conexión a Redis (`redisOptions`) y formato de errores | ✅ |
| `database/` | Configuración de TypeORM y migraciones SQL | ✅ |
| `documents/` | Entidad, carga y almacenamiento, validación de archivos, DTOs | ✅ |
| `graphql/` | Resolvers GraphQL (`uploadDocuments`, `uploadLimits`) | ✅ |
| `auth/` | Login del administrador, emisión y verificación de JWT, guard GraphQL, límite de intentos | ✅ |
| `indexing/` | Cola BullMQ, worker (`worker.ts`), extracción TXT/MD/PDF, construcción del `tsvector`, reintentos y reconciliación | ✅ |
| `search/` | Consulta FTS parametrizada, ranking, paginación y resaltado seguro | ✅ |
| `documents/` (lectura) | Detalle, estado y archivo original (`DocumentsController`) | ✅ |
| `events/` | `StatusPublisher` (worker → Redis), `StatusStream` (Redis → API) y `EventsController` (SSE con snapshot) | ✅ |

**Estilo de arquitectura:** modular por capas, con un módulo NestJS por capacidad (resolver/controlador → servicio → repositorio) y un worker en proceso separado. Se descartó una arquitectura hexagonal completa (puertos y adaptadores para cada dependencia): para un alcance de un día añade interfaces de una sola implementación sin beneficio práctico. La separación por módulos ya aísla las responsabilidades y permite extraer el worker o el motor de búsqueda más adelante.

## 2. Justificación de decisiones

### Stack

| Elección | Alternativas consideradas | Motivo |
|---|---|---|
| **NestJS 12** | Express, FastAPI, Spring Boot | Módulos, inyección de dependencias, pipes y guards nativos; TypeScript en todo el stack. La v12 es ESM nativo |
| **GraphQL multipart para la carga** | REST multipart | Aclaración posterior al enunciado. Una sola mutación tipada recibe archivos y metadatos |
| **PostgreSQL FTS** (`tsvector` + GIN) | Elasticsearch, OpenSearch, Meilisearch | Datos e índice en una sola tecnología: sin sincronización entre sistemas y sin un servicio extra que operar. Un motor dedicado se justificaría si las mediciones o el volumen lo exigen |
| **TypeORM** | SQL puro, Prisma | Repositorios y migraciones integrados con Nest. El SQL crítico (esquema FTS, consultas de búsqueda) se escribe a mano y parametrizado, sin depender de las abstracciones del ORM |
| **BullMQ + Redis** | Procesar dentro de la petición; cola en PostgreSQL (`SKIP LOCKED`) | La extracción de PDF puede tardar; la cola desacopla la respuesta, da reintentos y permite escalar workers |
| **SSE** | WebSocket, suscripciones GraphQL | Solo se necesita comunicación servidor → cliente. SSE funciona sobre HTTP con reconexión nativa y sin protocolo adicional |
| **Vitest + Supertest** | Jest | Es el runner que genera el CLI de Nest 12; el mismo runner se usará en el frontend |

### Versiones de dependencias

| Hallazgo | Decisión |
|---|---|
| `graphql-upload@18` exige `graphql@17`, pero Apollo Server 5 solo admite `graphql@16` | `graphql-upload@17.1` + `graphql@16` |
| npm 10.9 falla al resolver los *peer dependencies* (`edgesOut`) | Instalación con npm 11 |
| El CLI generó `vite-tsconfig-paths` y `@nestjs/mau` | Eliminados: sin alias de rutas ni despliegue en Mau |

### Carga de documentos

| Decisión | Motivo |
|---|---|
| Archivos y metadatos en argumentos separados, emparejados por índice | La validación de DTOs nunca recorre los streams de los archivos (`Promise<FileUpload>`) |
| Resultado por archivo (`id`+`status` **o** `error`) | En una carga masiva, un archivo inválido no bloquea al resto. También un fallo de base de datos en un archivo: los anteriores ya están registrados y encolados, y abortar la mutación invitaría a reenviar el lote y duplicarlos |
| Metadatos sin caracteres de control ni `U+FFFD` (`@Matches`) | Los caracteres `U+0002`–`U+0004` son los marcadores del resaltado; `U+FFFD` delata texto mal codificado. Se rechazan con un mensaje claro en lugar de guardarlos |
| Validación del contenido real: firma `%PDF-`; UTF-8 sin bytes nulos para TXT/MD | La extensión y el `mimetype` los decide el cliente |
| Nombre en disco = UUID; nombre original saneado solo como metadato | Evita *path traversal* y rutas adivinables |
| `MAX_UPLOAD_BYTES` = 10 MB, inclusivo y configurable | El enunciado no fija un valor; 10 MB es la orientación acordada. busboy corta al **alcanzar** el límite, por eso se le pasa `límite + 1` |
| `csrfPrevention` de Apollo activo | Un formulario de otro sitio puede enviar `multipart/form-data` sin preflight CORS; exigir una cabecera personalizada lo impide |
| HTTP 200 con `PROCESANDO` en el payload (no 202) | En GraphQL el código HTTP indica que la operación se procesó; el estado asíncrono del documento va en los datos |

### Modelo de permisos: administrador único

| Acción | Acceso |
|---|---|
| Subir documentos (`uploadDocuments`) | Solo administrador (JWT) |
| Buscar, ver detalle y visor, consultar `uploadLimits`, health | Público |
| Registro, recuperación de contraseña, roles | No existen (fuera de alcance) |

El enunciado define el actor de HU-01 como "Administrador / Desarrollador" y el de HU-02/03 como "Usuario". La aclaración posterior pide un login para un único administrador.

| Decisión | Alternativa | Motivo |
|---|---|---|
| Credenciales en el entorno: `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` | Tabla `users` con semilla | Con un solo usuario, una tabla añade migración, semilla y CRUD sin aportar nada. Si se necesitaran más usuarios, se pasaría a tabla |
| **Hash bcrypt** (`bcryptjs`, coste 12) en el `.env`, nunca la contraseña en claro | argon2 (nativo), `crypto.scrypt` | El kata pide bcrypt o argon2. `bcryptjs` es JavaScript puro: no necesita scripts de instalación nativos, que npm 11 pide aprobar explícitamente (`allowScripts`, observado al instalar `@apollo/protobufjs`) y que suelen dar problemas de compilación en Windows. Mismo formato `$2b$` que bcrypt |
| `npm run hash-password` lee la contraseña **sin eco** | Pasarla como argumento | Un argumento queda en el historial de la shell y en la lista de procesos |
| Hash entre comillas simples en `.env` | Sin comillas | El hash contiene `$`, y las comillas simples evitan que se interprete como variable. Verificado con `process.loadEnvFile`; con Docker Compose se verificará al dockerizar la API |
| **Arranque fallido** si `JWT_SECRET` tiene menos de 32 caracteres o `ADMIN_PASSWORD_HASH` no es bcrypt | Valores por defecto | Es preferible que la API no levante a que levante con un secreto débil. El `.env.example` deja ambos vacíos a propósito |
| JWT HS256, 8 h, sin refresh token | Sesión en servidor, refresh tokens | API sin estado entre peticiones (escala sin sesión compartida). 8 h cubren una jornada; un refresh token añade almacenamiento y rotación sin aportar a una demo |
| Algoritmo fijado al verificar (`algorithms: ['HS256']`) | Aceptar el del token | Impide ataques de confusión de algoritmo (`alg: none`) |
| bcrypt se ejecuta aunque el usuario no exista; usuario comparado en tiempo constante; mismo mensaje para ambos fallos | Responder antes | No revela si el usuario existe, ni por el mensaje ni por el tiempo de respuesta |
| Límite de **5 intentos por IP y minuto** en el login (`@nestjs/throttler`, 429) | Sin límite | Frena la fuerza bruta. Límite conocido: el contador vive en memoria por instancia; con réplicas, almacenarlo en Redis |
| **Middleware** que rechaza el multipart sin token **antes** de `graphql-upload` | Solo el guard del resolver | El guard se ejecuta después de que `graphql-upload` reciba los archivos: un anónimo podría hacer que el servidor recibiera hasta 10 × 10 MB por petición |
| **Además**, `GqlAuthGuard` en la mutación | Solo middleware | Autorización declarativa en el resolver (lo pide el kata). Protege cualquier mutación futura que no sea multipart (defensa en profundidad) |
| Sin revocación de tokens | Lista negra en Redis | Con un único administrador y una caducidad de 8 h, rotar `JWT_SECRET` basta para invalidar todos los tokens |

### Modelo de datos (migración `CreateDocuments`)

| Decisión | Motivo |
|---|---|
| `id UUID` | No enumerable. Se genera antes del INSERT y sirve también como nombre en disco |
| `tags TEXT[]` | Las etiquetas solo se muestran e indexan; un arreglo evita un JOIN con una tabla N:M |
| `status TEXT` + `CHECK (PROCESANDO, INDEXADO, ERROR)` | Estados del enunciado impuestos por la base de datos. Un `CHECK` es más fácil de evolucionar que un `ENUM` de Postgres |
| `CHECK (status <> 'INDEXADO' OR search_vector IS NOT NULL AND indexed_at IS NOT NULL)` | La base de datos impide marcar un documento como INDEXADO sin su índice |
| `content_indexed BOOLEAN` + `CHECK (NOT content_indexed OR extracted_text IS NOT NULL)`, en una **segunda migración** (`AddContentIndexed`) | Distingue los documentos indexados con contenido de los indexados solo por metadatos. Se añadió con una migración nueva, sin editar la anterior, como se haría con datos en producción. `down()` verificado: revertir y volver a aplicar |
| `storage_path` relativo a `STORAGE_DIR` | Permite mover el almacenamiento (o pasarlo a almacenamiento de objetos) sin reescribir filas. El código accede a los archivos solo a través de `FileStorage` |
| `search_vector` lo escribe el worker, no una columna generada | `array_to_string` no es `IMMUTABLE` (comprobado: `provolatile = s`). Además, un solo `UPDATE` hace atómica la transición a INDEXADO |
| SQL escrito a mano; `synchronize: false` | El esquema de búsqueda debe ser explícito y revisable |
| `migrationsRun: true` | La API migra al arrancar. Para varias réplicas pasaría a un paso del despliegue |

### Indexación: cola, concurrencia, reintentos e idempotencia

| Decisión | Alternativa | Motivo |
|---|---|---|
| **Worker en proceso separado** (`dist/worker.js`) | Procesar en la API | La extracción de PDF consume CPU y bloquearía el event loop de la API. Además, el worker escala de forma independiente (más réplicas) |
| `jobId = documentId` | Id aleatorio | Encolar dos veces el mismo documento no crea dos trabajos |
| `UPDATE … WHERE status = 'PROCESANDO'` en indexación y en error | Actualizar sin condición | **Idempotencia**: un reintento, un trabajo duplicado o dos workers con el mismo documento nunca reindexan ni pisan un estado final. Probado: reprocesar un documento `INDEXADO` lo deja igual |
| Un solo `UPDATE` con texto, `search_vector`, estado e `indexed_at` | Varios pasos | Transición atómica: nunca hay un `INDEXADO` sin índice (además lo garantiza el `CHECK` de la tabla) |
| **Errores definitivos** (PDF dañado o protegido, archivo inexistente, `tsvector` de más de 1 MB) → `ERROR` sin reintentar | Reintentar todo | Reintentar un PDF dañado da el mismo resultado; solo retrasa el aviso al usuario |
| **Sin texto extraíble** (PDF escaneado, archivo en blanco) → `INDEXADO` solo por título y metadatos, con `content_indexed = false` (*decisión del propietario*) | `ERROR`; OCR | El documento sigue siendo útil y localizable por sus metadatos, y la marca permite identificarlo y avisarlo en la interfaz. OCR (p. ej. Tesseract) queda fuera del alcance |
| **Errores transitorios** (BD o Redis caídos) → 3 intentos con espera exponencial (2 s, 4 s); agotados → `ERROR` | Sin reintentos | Una caída breve no debe marcar documentos válidos como erróneos |
| **Reconciliación** al arrancar el worker: reencola los `PROCESANDO` | Aceptar documentos atascados | Si Redis falla justo después del INSERT, la API registra el error, responde `PROCESANDO` y el documento se recupera al reiniciar el worker. BullMQ **ignora** `add()` si ya existe un trabajo con ese `jobId` (los fallidos se retienen), así que antes se elimina el trabajo terminado, fallido o en estado desconocido; uno en espera o activo se deja. Un fallo con un documento se registra y no impide recuperar el resto. Probado en e2e con un trabajo fallido retenido. Límite: no es periódica; con un `JobScheduler` de BullMQ lo sería |
| Marcar `ERROR` al agotar los reintentos, con el fallo capturado y registrado | Dejar que la promesa rechace | Si la base de datos sigue caída, un rechazo no gestionado podría tumbar el worker. El documento queda en `PROCESANDO` y lo recupera la reconciliación |
| Concurrencia configurable (`INDEXING_CONCURRENCY`, por defecto 2) | Fija | Ajustable según la CPU disponible; se aplica en tiempo de ejecución (el decorador se evaluaría antes de cargar `.env`) |
| Redis con AOF y `noeviction` | Configuración por defecto | Los trabajos sobreviven a un reinicio de Redis y nunca se descartan por memoria |
| **`unpdf`** para PDF | `pdf-parse`, `pdfjs-dist` | Sin dependencias (trae pdfjs empaquetado). `pdf-parse` 2.x arrastra un binario nativo (`@napi-rs/canvas`) |
| Markdown indexado en bruto | Convertirlo a texto plano | El parser de PostgreSQL ya descarta `#`, `*` y `>` al construir el `tsvector`; convertirlo añadiría dependencias sin cambiar el índice |
| NUL se elimina; el resto de caracteres de control (salvo tabulador y saltos de línea) se sustituye por un espacio | Eliminar solo NUL; sustituirlos todos | PostgreSQL no admite `\0` en `TEXT`, y algunos PDF lo emiten dentro de una palabra (un espacio la partiría). `U+0002`–`U+0004` son los marcadores del resaltado: un `.txt` que los contuviera desordenaría los fragmentos. El salto de página `U+000C` separa palabras, por eso pasa a espacio |
| `loadingTask.destroy()` del PDF en un `finally` | Confiar en el recolector | unpdf solo libera los documentos que crea él; sin liberarlo, cada PDF retendría memoria de pdf.js en un proceso de larga duración |

### Diseño del índice full-text

- **Índice GIN** sobre `search_vector`. Es un índice invertido (lexema → filas): `search_vector @@ tsquery` no recorre la tabla, a diferencia de `LIKE '%x%'`. Se prefiere a GiST porque es más rápido en lectura, y aquí se lee mucho más de lo que se escribe.
- ✅ **Pesos** con `setweight`: título **A**; autor, categoría, versión y etiquetas **B**; contenido extraído **C**. Verificado en pruebas (`nginx:C` coincide y `nginx:A` no).
- ✅ **Diccionario `simple`:** normaliza a minúsculas sin stemming ni stopwords. Un corpus técnico mezcla español, inglés y términos propios (`k8s`, `pg_dump`, nombres de API) que un diccionario de idioma podría recortar o descartar. Limitación: "documento" no coincide con "documentos", y las palabras vacías ("de", "la") también se indexan.
- **Límite de PostgreSQL:** un `tsvector` ocupa como máximo 1 MB (SQLSTATE `54000`). Medido: 10 MB de texto con 20 000 términos distintos se indexan sin problema; unas 300 000 palabras distintas lo superan, y el documento pasa a `ERROR` con su causa.
- **Sin texto extraíble:** el vector contiene solo los lexemas A y B (título y metadatos), y `content_indexed = false`.
### Búsqueda: consulta, relevancia, fragmentos y paginación

| Decisión | Alternativa | Motivo |
|---|---|---|
| `websearch_to_tsquery('simple', $1)` | `to_tsquery`, `plainto_tsquery` | Acepta texto de usuario **sin errores de sintaxis** y admite `"frase exacta"`, `OR` y `-exclusión`. `to_tsquery` falla ante entradas como `a & \|`; `plainto_tsquery` no admite frases ni operadores |
| Relevancia con `ts_rank` (pesos A/B/C) | `ts_rank_cd` (*cover density*) | Ambas respetan los pesos (título > metadatos > contenido), y se verificó que un término en el título queda por encima de uno solo en el contenido. `ts_rank_cd` además premia la cercanía entre términos, pero **costaba un 65 % más** (650 ms frente a 395 ms al puntuar 10 000 coincidencias) y no cumplía el objetivo de latencia. La cercanía de las frases ya la exige `"…"` en el filtro. Era la decisión inicial; se cambió por la medición |
| Orden `rank DESC, created_at DESC, id DESC` | Solo `rank` | A igual relevancia el orden queda indefinido y una fila podría repetirse o desaparecer entre páginas. Con el desempate por `id` es total y estable (verificado: 25 resultados en 3 páginas sin solapes) |
| Total con **tope** (`LIMIT 1001` en una consulta aparte, en paralelo) → `totalCapped` y "más de 1 000 resultados" | `count(*) OVER ()` en la misma consulta (decisión inicial) | `count(*) OVER ()` obligaba a una agregación de ventana sobre todas las coincidencias en un solo proceso. El conteo con tope se detiene al llegar al límite (19 ms frente a ~180 ms) y es lo habitual en buscadores. Configurable con `SEARCH_COUNT_CAP` |
| `ts_headline` **solo para las filas de la página** (CTE) | Para todas las coincidencias | `ts_headline` vuelve a analizar el texto y es lo más caro de la consulta. Calcularlo para 10 filas en vez de miles mantiene la latencia acotada |
| `ts_headline` sobre los primeros **50 000 caracteres** | El texto completo | Acota el coste por fila en documentos de varios MB. Límite: una coincidencia más allá encuentra el documento (el filtro usa el índice completo), pero su fragmento muestra el inicio sin resaltar |
| **Marcadores de control** (`\u0002`/`\u0003`) → segmentos `{ text, match }` | `<b>…</b>` de `ts_headline` insertado como HTML | **Comprobado en psql: `ts_headline` no escapa HTML.** Devuelve `<img src=x onerror=alert(2)>` tal cual e incluso puede cortar una etiqueta a la mitad. Insertarlo con `innerHTML` sería XSS. Con segmentos, el cliente pinta `<mark>` como nodos de texto |
| `LIMIT/OFFSET` con página máxima 1000 | Paginación por cursor (*keyset*) | Para resultados ordenados por relevancia, el cursor exigiría arrastrar `(rank, created_at, id)`. `OFFSET` es suficiente para el volumen esperado y el tope evita consultas costosas muy profundas |
| Solo documentos `INDEXADO` | Mostrar también los `PROCESANDO` | Un documento sin índice no puede coincidir. El estado de los que se están procesando se consulta en `/status` |
| Cabecera `Server-Timing: db;dur=…` | Solo registros en el servidor | Separa el tiempo de base de datos de la latencia HTTP total, como pide la medición de rendimiento; se ve también en las herramientas del navegador |
| Prueba que impide `LIKE`/`ILIKE` en `src/search` y `src/documents` | Revisión manual | Requisito duro del enunciado. La prueba ignora los comentarios y se verificó que falla al introducir un `ILIKE` |

### Archivo original para el visor

| Decisión | Motivo |
|---|---|
| `res.sendFile` | Aporta `Range` (206; PDF.js carga por partes), `ETag` y `Last-Modified` sin código propio. Verificado: `bytes=2-5` → 206 |
| `Content-Type` desde `mime_type` validado en la carga (texto con `charset=utf-8`) | El tipo lo decide el backend, no la extensión del archivo en disco (que no tiene) |
| `Content-Disposition: inline` + `filename*` (RFC 6266) | El navegador lo muestra en lugar de descargarlo. Los nombres con tildes se conservan (`'`, `(`, `)` y `*` se codifican también, como exige RFC 5987); `?download=1` lo convierte en `attachment` |
| `X-Content-Type-Options: nosniff` | El navegador no "adivina" HTML en un `.txt` subido |
| Ruta física nunca expuesta; archivo resuelto por `id` → `storage_path` | Sin *path traversal*: el cliente nunca indica una ruta |
- Índice `(created_at DESC, id DESC)` para listados y como desempate estable de la paginación.

### Errores de la API

| Decisión | Alternativa | Motivo |
|---|---|---|
| REST: `{ statusCode, error, message }` en español (`HttpErrorFilter`) | Formato por defecto de Nest | Un solo formato para validación, 404, credenciales y rutas inexistentes. Un 500 devuelve un mensaje genérico y se registra en el servidor |
| GraphQL: `{ message, extensions: { code, details } }` (`formatError`) | El `"Bad Request Exception"` de Nest con el detalle en `originalError` | El cliente muestra `message` tal cual; `details` trae un error por campo. Nunca sale `originalError` ni la traza (`includeStacktraceInErrorResponses: false`) |
| Mensajes de class-validator traducidos por regla (`exceptionFactory`): "Documento 2 · título: admite como máximo 200 caracteres" | i18n completo | class-validator no permite cambiar el idioma globalmente. Es un mapa pequeño de reglas y campos, cubierto por pruebas e2e. Una regla sin traducir mantiene su texto original |
| Errores de cliente de Express (JSON mal formado, cuerpo de más de 100 kB, multipart de graphql-upload) → `requestErrorHandler`, con el formato de su ruta | La página HTML de Express o el texto de body-parser ("Unexpected end of JSON input") | Superar el máximo de archivos devolvía HTML. El JSON se parsea en `configureApp`, porque Nest registra su parser después de los middlewares propios y sus errores no pasarían por el manejador |
| Si la respuesta ya empezó (SSE, archivo), el filtro cierra la conexión | Dejarla abierta | No cabe otra respuesta; es lo que hace el filtro por defecto de Nest |

### Latencia: medición y optimización

**Objetivo:** el enunciado pide respuestas "entre 400 ms y 1 s". Se interpreta como un **máximo de 1 s**: una respuesta más rápida cumple, y no se añade ningún retardo artificial.

**Método** (reproducible: `npm run seed` + `npm run benchmark`; informe completo en [benchmark.md](benchmark.md)):
- 10 000 documentos sintéticos (175 MB de texto, 2–200 KB cada uno, vocabulario técnico con distribución de Zipf), indexados **por el pipeline real**: 46 s, 216 documentos/s con 4 en paralelo y 0 errores.
- Latencia **HTTP de extremo a extremo** (p50/p95/máx, 30 mediciones tras calentar) frente al tiempo de base de datos (`Server-Timing`).
- Consultas: término frecuente (en el 100 % de los documentos, el peor caso), dos términos, frase, selectiva, OR, exclusión, sin resultados y página 50; además 10 clientes concurrentes.
- `EXPLAIN (ANALYZE, BUFFERS)` de la consulta **exacta** de la API.

**Primera medición: fuera del objetivo en las consultas amplias.**

| Caso | p95 antes | p95 después |
|---|---|---|
| Término frecuente | 772 ms | **277 ms** |
| Dos términos | 1 199 ms | **418 ms** |
| Frase exacta | 1 243 ms | **462 ms** |
| OR | 842 ms | **294 ms** |
| Página 50 | 545 ms | **343 ms** |
| Selectiva / sin resultados | 4 / 3 ms | 5 / 3 ms |
| **10 clientes concurrentes** | **2 078 ms** | **778 ms** |
| Rendimiento con 10 clientes | 11 búsquedas/s | **26 búsquedas/s** |

Antes y después se midieron con la misma base, el mismo corpus y el mismo script, tras `VACUUM ANALYZE`.

**Diagnóstico** (plan de ejecución y tiempos aislados en psql):

| Paso, término presente en los 10 000 documentos | Tiempo |
|---|---|
| El índice GIN encuentra las coincidencias | 0,6 ms |
| Puntuar **todas** las coincidencias con `ts_rank_cd` (leer 63 MB de vectores TOAST y calcular) | ≈ 650 ms |
| …con `ts_rank` | ≈ 395 ms |
| Leer los vectores sin puntuar | ≈ 360 ms |
| `count(*) OVER ()`: agregación de ventana sobre todas las coincidencias, en un proceso | Impedía el *top-N* directo |

Encontrar coincidencias es casi gratis gracias al índice. El coste está en **ordenar por relevancia**, porque hay que puntuar cada coincidencia para quedarse con 10.

**Cambios aplicados:**
1. `ts_rank` en lugar de `ts_rank_cd` (ver la tabla de decisiones de búsqueda).
2. Total en una consulta aparte con **tope de 1 000**, ejecutada en paralelo con la página (`totalCapped` → "más de 1 000 resultados").

**Experimentos descartados** (medidos y revertidos):

| Idea | Resultado | Por qué no |
|---|---|---|
| Columna `rank_vector` reducida (título + metadatos + 4 KB de contenido) para puntuar | 560 ms (≈ −14 %) | Sigue ocupando más de lo que cabe en la fila (TOAST); poca ganancia para una columna y una migración más |
| Compresión `lz4` en `search_vector` y `extracted_text` | 750–880 ms (**peor**) | Los vectores no estaban comprimidos (`pglz` no compensa en ellos). El coste es leer y puntuar, no descomprimir |
| Paralelizar el ranking | No se activó | El planificador ve la tabla principal pequeña (6 MB); el coste real está en TOAST, fuera de su modelo |

**Límites:** medido en local, sin latencia de red, con PostgreSQL sin ajustar y un corpus sintético. El coste de las consultas amplias crece con el **número de coincidencias**. Ver "4. Escalabilidad".

### Frontend

| Decisión | Alternativa | Motivo |
|---|---|---|
| **React + Vite** (SPA) | Next.js | No hace falta SEO ni renderizado en servidor: las vistas dependen de datos de la API. Vite arranca al instante y el build es estático |
| **Proxy de Vite** (`/api`, `/graphql` → API) | CORS en la API | Un solo origen para el navegador: sin CORS, el `EventSource` y el token funcionan tal cual. En producción, un proxy inverso (nginx) cumple la misma función. El destino es configurable (`API_URL`): en la máquina de desarrollo el puerto 3000 lo ocupaba otra aplicación |
| **Sistema de diseño Cajetín** → `tokens.css` + Tailwind `@theme inline` | Colores y tamaños sueltos en las clases | Una sola fuente de valores. Ningún componente tiene un hex literal. Contraste WCAG AA verificado por cálculo en claro y oscuro |
| Espaciado con la escala por defecto de Tailwind | Tokens propios | Tailwind ya usa pasos de 4px (`p-4` = 16px = `space-4`): coincide con la retícula de Cajetín sin redeclarar nada |
| **Consulta en la URL** (`/buscar?q=&page=`) | Estado local | Se puede compartir, recargar y usar el botón Atrás. La paginación son enlaces reales |
| `AbortController` por búsqueda + respuesta etiquetada con su consulta | Ignorar respuestas viejas | Una búsqueda nueva cancela la anterior. Además, el estado "cargando" se **deriva** comparando la consulta actual con la de la última respuesta, sin `setState` dentro del efecto (render extra señalado por el linter) |
| **Resaltado con `<Highlight>`** (segmentos → `<mark>` + texto) | `dangerouslySetInnerHTML` con `<b>` | `ts_headline` no escapa HTML (comprobado). React escapa cada segmento; una prueba verifica que un `<img onerror>` del documento llega como texto |
| **PDF original en `<iframe>`** (visor nativo del navegador) | PDF.js empaquetado; mostrar el texto extraído | El requisito pide el original embebido. El visor nativo no añade peso al bundle y la API ya sirve `inline` + `Range`. PDF.js queda como mejora si se necesitara un visor homogéneo entre navegadores |
| **react-markdown sin `rehype-raw`** | `marked` + `innerHTML` | El HTML incrustado en un `.md` no se inserta (probado con `<script>` e `<img onerror>`) y los enlaces `javascript:` se neutralizan |
| **JWT en `sessionStorage`** | Cookie `httpOnly`; memoria | Sobrevive a recargar la pestaña y se borra al cerrarla. Riesgo asumido: un XSS podría leerlo. Se mitiga al no insertar nunca HTML del documento; una cookie `httpOnly` exigiría protección CSRF propia en la API |
| `RequireAdmin` + "Cargar" visible solo con sesión | Mostrar y fallar con 401 | La interfaz refleja el permiso real; la API lo hace cumplir de todos modos |
| Pruebas con Testing Library + `fetch` simulado sobre la **app completa** (rutas + sesión) | Pruebas de componentes aislados | Prueban lo que ve el usuario: roles, textos y enlaces, igual que con un lector de pantalla |
| **Validación previa a la carga con `uploadLimits`** (extensión, tamaño, vacío, máximo por lote) | Límites escritos en el frontend; validar solo en el servidor | Un solo origen para los límites y respuesta inmediata con el motivo de cada rechazo. El atributo `accept` del selector no filtra lo que se **arrastra**, así que el código valida siempre. El servidor revalida y comprueba el contenido real |
| **Autor y categoría comunes al lote; título, versión y etiquetas por archivo** | Todos los campos por archivo | En una carga masiva el autor y la categoría suelen coincidir; escribirlos diez veces invita a errores. El contrato de la API sigue siendo por documento, así que cambiar esta decisión solo afecta a la interfaz |
| `useDocumentStatuses(ids)`: un `EventSource` por vista con `?ids=` y **el evento de `updatedAt` más reciente** por documento | Una conexión por documento; aplicar en orden de llegada | Una sola conexión sigue todo el lote. El orden de llegada no es cronológico (observado en el Bloque 4), así que manda `updatedAt` (función pura `applyStatus`, probada) |
| El detalle escucha el SSE **solo mientras el documento está en `PROCESANDO`** y recarga al recibir el cambio | Escuchar siempre; actualizar campos sueltos con el evento | Ninguna conexión abierta sin necesidad. Recargar trae también `indexedAt` y deja el detalle consistente con la fuente de verdad |
| Sesión caducada (401) → `expire()` en el contexto de sesión | Cerrar sesión y navegar al login con un estado | React Router 8 aplica la navegación como transición de baja prioridad: el cierre de sesión se procesaba antes y la ruta protegida redirigía **sin** el aviso (lo detectó una prueba). Con `expire()` el motivo vive en el contexto y el login lo lee, sin depender del orden |
| Anuncios `aria-live` derivados del último evento | Toast visual | El lector de pantalla oye "Manual: indexado" sin interrumpir; el resumen visible del lote cambia de "N en proceso" a "Lote procesado" |

## 3. Estrategia de tiempo real

La HU-04 prohíbe el *polling*: la interfaz debe enterarse cuando un documento pasa a `INDEXADO` o `ERROR` sin preguntar periódicamente.

```mermaid
sequenceDiagram
    participant C as Navegador (EventSource)
    participant A as API (instancia N)
    participant R as Redis Pub/Sub
    participant P as PostgreSQL
    participant W as Worker

    C->>A: GET /api/events?ids=X
    A->>R: (ya suscrita al arrancar)
    A-->>C: event: ready (retry: 3000)
    A->>P: SELECT estado de X (snapshot)
    A-->>C: event: status {X, PROCESANDO, updatedAt t1}
    W->>P: UPDATE … SET status='INDEXADO' RETURNING …
    W->>R: PUBLISH {X, INDEXADO, updatedAt t2}
    R-->>A: mensaje
    A-->>C: event: status {X, INDEXADO, t2}
    Note over C,A: Si se corta la conexión, EventSource reconecta<br/>y el snapshot repone lo ocurrido mientras tanto
```

### Componentes

| Pieza | Responsabilidad |
|---|---|
| `StatusPublisher` (worker) | Tras cada `UPDATE` que cambia el estado, publica `{ id, status, contentIndexed, errorMessage, updatedAt }` tomado de `RETURNING`: se publica exactamente lo que se guardó |
| `StatusStream` (API) | **Una** conexión suscriptora por instancia, repartida con un `Subject` de RxJS a todos los clientes. Diez pestañas abiertas no abren diez conexiones a Redis |
| `EventsController` (`@Sse`) | Por cliente: filtra por `ids`, envía el snapshot, los eventos en vivo y un heartbeat |

### Decisiones

| Decisión | Alternativa | Motivo |
|---|---|---|
| **SSE** | WebSocket; suscripciones GraphQL (`graphql-ws`) | La comunicación es solo servidor → cliente. SSE es HTTP estándar, `EventSource` reconecta solo y funciona con proxies sin protocolo extra. Las suscripciones GraphQL añadirían `graphql-ws` y un segundo transporte (WebSocket) para algo que SSE resuelve con un endpoint |
| **Redis Pub/Sub** entre worker y API | Emisor en memoria (`EventEmitter`) | El worker es **otro proceso**: un emisor en memoria no cruza procesos. Con varias instancias de la API, cada una se suscribe y recibe el evento |
| **Snapshot al conectar** (en el propio flujo SSE) | Solo eventos en vivo | **Pub/Sub no guarda mensajes:** un evento publicado sin nadie escuchando se pierde. El snapshot desde PostgreSQL, la fuente de verdad, repone el estado en cada conexión y reconexión. Verificado: un cambio ocurrido con el cliente desconectado llega al reconectar |
| Suscribirse a lo vivo **antes** de leer el snapshot (`merge(live$, …, snapshot$)`) | Leer primero el snapshot | Si se leyera primero, un cambio ocurrido entre la lectura y la suscripción se perdería |
| Cada evento lleva `updatedAt`; el cliente conserva el más reciente | Confiar en el orden de llegada | Snapshot y evento en vivo pueden llegar cruzados, y con concurrencia el worker publica en cualquier orden (observado en la prueba manual: el `ERROR` llegó antes que un `INDEXADO` anterior) |
| Filtro `?ids=` (máx. 50, UUID validados) | Enviar todo a todos | Cada pestaña recibe solo lo que sigue. Sin `ids` recibe todo (útil para listados) |
| Heartbeat como **comentario SSE** cada 25 s | Evento `ping` | `EventSource` ignora los comentarios. Mantienen viva la conexión a través de proxies con *timeout* por inactividad |
| `retry: 3000` | Valor por defecto del navegador | Reconexión rápida y predecible tras un corte |
| Publicar nunca falla la indexación | Propagar el error | El estado ya está en PostgreSQL; el snapshot recupera el evento perdido |
| Canal configurable (`EVENTS_CHANNEL`) | Fijo | Pub/Sub ignora el número de base Redis: pruebas y demo sobre el mismo Redis usan canales distintos |
| Solo se publican los estados finales | Publicar también `PROCESANDO` | El cliente ya conoce el `PROCESANDO` por la respuesta de la carga. La HU-04 pide notificar `INDEXADO` o `ERROR` |

### Fallos de red y degradación

| Situación | Comportamiento |
|---|---|
| El cliente pierde la conexión | `EventSource` reconecta cada 3 s; al reconectar recibe el snapshot actualizado |
| Redis cae un momento | *No probado.* Por diseño, un error de publicación se captura y no revierte la indexación, que ya está en PostgreSQL. Pero sin Redis tampoco funciona la cola, así que el worker deja de recibir trabajos hasta que vuelve, e `ioredis` retiene los comandos mientras reconecta. Al recuperarse, los clientes obtienen el estado correcto con el snapshot de su siguiente (re)conexión |
| Se reinicia la API | Las conexiones SSE se cierran, `EventSource` reconecta (comportamiento estándar del navegador) y llega el snapshot |
| Varias instancias de la API | Cada una tiene su suscripción; el cliente puede reconectar a cualquiera |

**Limitación conocida:** si Redis falla mientras el cliente sigue conectado, ese cliente no ve el cambio hasta que se reconecta (no hay re-snapshot periódico). PostgreSQL mantiene el estado correcto y `GET /api/documents/:id/status` lo devuelve.

## 4. Escalabilidad

¿Cómo responde la arquitectura a un incremento masivo de documentos? Por componente, de lo ya preparado a lo que habría que cambiar.

### Ya preparado

| Componente | Cómo escala | Por qué funciona |
|---|---|---|
| **API** | Réplicas detrás de un balanceador | No guarda estado entre peticiones: JWT sin sesión en servidor, archivos en un almacenamiento común y eventos vía Redis Pub/Sub, que llegan a todas las réplicas |
| **Indexación** | Más procesos worker sobre la misma cola, o más `INDEXING_CONCURRENCY` | La cola reparte los trabajos; la idempotencia (`jobId`, `WHERE status = 'PROCESANDO'`) hace segura la concurrencia. Medido: 216 documentos/s con un worker y concurrencia 4 |
| **Carga de picos** | La cola absorbe ráfagas | La API responde `PROCESANDO` al instante aunque haya miles de documentos esperando |
| **Búsqueda selectiva** | Casi constante | El GIN localiza un término raro en milisegundos con independencia del tamaño de la tabla (medido: 4 ms con 10 000 documentos) |
| **Tiempo real** | Una suscripción Redis por réplica | N pestañas abiertas no multiplican las conexiones a Redis |

### Dónde aparece el límite: consultas amplias

El coste de ordenar por relevancia crece con el **número de coincidencias**, no con el tamaño total: `ts_rank` puntúa cada coincidencia para quedarse con 10. Con 10 000 documentos, un término presente en todos tarda unos 277 ms (p95). Con un crecimiento de 10×, ese caso crecería de forma aproximadamente lineal y superaría el segundo. Opciones, de menor a mayor cambio:

1. **Ajustar PostgreSQL:** `shared_buffers`, `work_mem` y paralelismo forzado por tabla (`parallel_workers`). Sin cambios de código.
2. **Réplicas de lectura de PostgreSQL** para repartir las búsquedas. La API ya separa lecturas y escrituras por módulo.
3. **Puntuar un subconjunto acotado** cuando el término es muy frecuente (relevancia aproximada para consultas genéricas), o usar la extensión **RUM**, que guarda posiciones en el índice y ordena por relevancia sin leer los vectores. Requiere una imagen de PostgreSQL con la extensión.
4. **Motor dedicado** (Elasticsearch/OpenSearch), con *top-k* eficiente (BM25 + WAND), réplicas y *sharding*. El cambio sería localizado: el worker publicaría también en el motor, y `SearchService` cambiaría su implementación. El precio es un segundo sistema que sincronizar y operar.

### Otros límites al crecer

- **Almacenamiento de originales:** `STORAGE_DIR` local. Con varias réplicas o mucho volumen, almacenamiento de objetos (S3 o compatible). `storage_path` es relativo (no hay que reescribir filas) y `FileStorage` es el único punto que toca el disco: el cambio se concentra en esa clase y en cómo se sirve el original (hoy `sendFile`, con S3 un *stream* o una URL firmada).
- **Tamaño de la tabla:** particionar `documents` (por fecha o categoría) mantiene los índices y el `VACUUM` manejables.
- **Paginación profunda:** `OFFSET` está acotado (página ≤ 1 000) y el total se cuenta con tope, así que una consulta amplia nunca recorre todo solo para contar.
- **Mantenimiento del índice:** las cargas masivas acumulan entradas en la lista pendiente del GIN (*fastupdate*). El autovacuum la vacía; en cargas masivas conviene un `VACUUM ANALYZE` al terminar (observado en la medición: el índice pasó de 8,6 a 4,3 MB y las estadísticas cambiaron los planes).

## 5. Desviaciones respecto a la estructura de referencia

| Referencia | Implementado | Motivo |
|---|---|---|
| Migraciones en `backend/migrations/` | `backend/src/database/migrations/` | Dentro de `src/` las compila `nest build` y se importan como clases, que funciona igual en ESM, en `dist/` y en Vitest (los globs de archivos no) |
| `.env.example` en la raíz | `backend/.env.example` | La API carga `.env` desde su propio directorio de trabajo |
| — | `docker/postgres/init/` | Script de inicialización que crea la base `documents_test` |
| `packages/shared/` (opcional) | No se crea | Los tipos de la API se repiten en `frontend/src/services/api.ts` (unos 10 tipos pequeños). Se asume la duplicación frente a montar un paquete compartido con su build en ambos proyectos; si el contrato creciera, se generarían desde el esquema GraphQL |

## 6. Calidad del diseño y deuda conocida

Revisión SOLID hecha tras la auditoría del 2026-10-28:

- **S**: controladores delgados y lógica pura aislada y probada (`file-validation`, `highlight`, `text-extraction`, `status-store`, `page-window`). La carga de cada archivo se separó en recibir → registrar → encolar. `UploadPage.tsx` sigue concentrando bastante estado del formulario.
- **O**: añadir un formato exige tocar `text-extraction` (decisión por MIME), `file-validation` y el mapa MIME del frontend. Con tres formatos, un registro `{ mime: extractor }` sería una abstracción sin segundo uso.
- **D**: el almacenamiento está detrás de `FileStorage`. La configuración se lee con la función `appConfig()` en lugar de `ConfigService`: es más simple y la comparten el worker y los scripts, a cambio de no poder inyectar otra en las pruebas (se usan variables de entorno).
- Las consultas de búsqueda usan SQL concreto de PostgreSQL a propósito: el FTS es el requisito, no un detalle intercambiable.

## 7. Limitaciones conocidas

- Límite de intentos de login en memoria por instancia (ver modelo de permisos).
- No hay revocación de tokens antes de su caducidad.
- Sin OCR: un PDF escaneado solo se encuentra por título y metadatos (`content_indexed = false`).
- Los fragmentos resaltados solo cubren los primeros 50 000 caracteres de cada documento.
- Sin *stemming* (diccionario `simple`): no hay coincidencia entre singular y plural.
- Latencia medida en local con 10 000 documentos sintéticos (ver [benchmark.md](benchmark.md)): las consultas amplias crecen con el número de coincidencias (ver "4. Escalabilidad").
- El total de resultados se cuenta con un tope de 1 000 ("más de 1 000 resultados").
- SSE: un evento publicado mientras Redis está caído y el cliente sigue conectado no llega hasta la siguiente reconexión de ese cliente.
- La reconciliación de documentos atascados ocurre solo al arrancar el worker, no de forma periódica.
- No se ha probado la carga con Redis caído. Por diseño, el documento queda registrado y se recupera con la reconciliación, pero no se ha medido cuánto tarda en responder `queue.add` mientras Redis no está disponible.
- Las migraciones se ejecutan al arrancar la API; no es apto para varias réplicas sin un paso de despliegue dedicado.
