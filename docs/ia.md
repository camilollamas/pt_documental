# Uso de Inteligencia Artificial

> Documento vivo: se actualiza al cerrar cada bloque con lo que realmente ocurrió.

## Enfoque de trabajo

La IA se usó como **asistente de implementación bajo dirección técnica del desarrollador**. El desarrollador:

- **Define el marco técnico** antes de escribir código: entrega un documento técnico con el stack, las restricciones (FTS sin `LIKE`, carga por GraphQL multipart, SSE sin polling, administrador único), la estructura del repositorio y las reglas de trabajo.
- **Decide** el alcance y los criterios cuando hay alternativas.
- **Audita** cada entrega antes de continuar y **controla el versionado**: la IA no hace commits ni push.

El trabajo avanza en **bloques pequeños y verificables**. Cada bloque se cierra con:
1. lo que se implementó y por qué;
2. las alternativas descartadas;
3. los comandos para verificarlo de forma independiente;
4. las preguntas técnicas previsibles.

Solo con el visto bueno del desarrollador se pasa al siguiente bloque.

## 1. Herramientas utilizadas

| Herramienta | Uso |
|---|---|
| **Claude Code** (modelo Claude Opus 5.5), extensión de VS Code | Análisis de requisitos, propuesta de plan, generación de código y pruebas, diagnóstico de errores y borradores de documentación |
| **Context7** (servidor MCP de documentación) | Consulta de la documentación vigente de TypeORM 1.x, BullMQ 6 y SSE en NestJS 12 para no usar APIs obsoletas |
| **Claude Artifacts** (tipo "Design System") | Publicación del sistema de diseño "Cajetín" como referencia navegable de tokens y componentes |

## 2. Casos de uso por etapa

| Etapa | Dirección y decisiones del desarrollador | Aporte de la IA |
|---|---|---|
| Análisis y planificación | Aporta el documento técnico (stack, restricciones, estructura y reglas). Pide contrastar el plan con el enunciado oficial. Detectada la discrepancia en los nombres de estado, **decide usar los literales del enunciado** (`PROCESANDO`/`INDEXADO`/`ERROR`) | Lee el enunciado y el documento técnico, propone un plan por bloques y una matriz requisito → implementación → prueba, y señala las diferencias entre ambos documentos |
| Bloque 1: carga GraphQL multipart | Define la carga por GraphQL multipart con metadatos. Revisa el bloque, gestiona el commit y exige un mensaje de commit que describa con detalle lo implementado | Genera el esqueleto NestJS, la mutación, la validación de archivos y las pruebas. Diagnostica un bug de npm 10, un conflicto de versiones `graphql`/`graphql-upload` y el corte de busboy en el límite exacto de tamaño |
| Bloque 2a: persistencia | Fija la política de credenciales (hash en el entorno, nunca en claro), la duración del token (8 h, sin refresh) y el puerto de PostgreSQL. Exige que la migración SQL venga **explicada línea por línea** para poder defenderla. Reubica `.env.example` en `backend/` | Genera `docker-compose.yml`, la migración (índice GIN, `CHECK` de estados), la entidad y las pruebas contra PostgreSQL real |
| Auditoría de estructura | Pide una **auditoría** del repositorio contra el punto 5 del enunciado. Crea el repositorio remoto y ordena adelantar la documentación obligatoria | Contrasta la estructura, detecta la documentación faltante, el `.gitignore` sin versionar y un mensaje de commit truncado, y propone correcciones |
| Bloque 2b: login del administrador | Valida el diseño de autenticación. Decide **no reescribir** el historial de Git, priorizando avanzar | Genera el módulo de autenticación, el script de hash y las pruebas. Detecta que el guard actúa después de recibir los archivos y añade un middleware previo |
| Bloque 2c: cola e indexación | Ejecuta las pruebas e2e del bloque anterior y aporta la evidencia antes de autorizar el avance. **Decide el tratamiento de los documentos sin texto extraíble** (PDF escaneado): rechaza dejarlos en `ERROR`, que era la propuesta inicial, y pide indexarlos por metadatos **marcados** para poder identificarlos. Ese cambio introdujo la segunda migración (`content_indexed`). Se le ofreció escribir la prueba "PDF dañado → `ERROR` sin detener el worker" y delegó su redacción en la IA | Genera la cola BullMQ, el worker separado, la extracción con `unpdf` y la indexación con pesos A/B/C. Detecta y corrige dos fallos propios: la concurrencia leída antes de cargar `.env` y un log de "indexado" que no comprobaba las filas afectadas. Verifica el límite de 1 MB del `tsvector` en PostgreSQL antes de documentarlo. Escribe, a petición del desarrollador, la prueba del PDF dañado dentro de un lote con un documento válido |
| Bloque 3: búsqueda, detalle y original | Autoriza el bloque | Genera la consulta FTS (`websearch_to_tsquery`, `ts_rank_cd`, `ts_headline` paginado), el resaltado por segmentos, los endpoints de detalle, estado y original, y 19 pruebas e2e. Al verificar en psql descubre que `ts_headline` no escapa HTML, lo que confirma el diseño de segmentos. Una prueba demasiado ingenua (detectaba "LIKE" en un comentario) se corrige, y se comprueba con una mutación que sigue detectando un `ILIKE` real |
| Bloque 4: tiempo real | Autoriza el bloque | Genera la publicación en Redis desde el worker, la suscripción única por instancia y el endpoint SSE con snapshot, filtro por ids y heartbeat, más 9 pruebas e2e con un cliente SSE sobre el protocolo real. Comprueba con una mutación (publicación desactivada) que fallan exactamente las 5 pruebas que dependen de eventos en vivo. Escribe por error una interpolación que habría dejado texto literal en el SQL y la corrige antes de compilar. Reformula una afirmación no comprobada sobre Redis caído |
| Sistema de diseño "Cajetín" | Pide establecer un sistema visual con estándares antes del frontend (skill `/design:design-system`). Decide el tratamiento de **usted** en los textos, los iconos Lucide y las familias tipográficas propuestas | Propone la identidad (nombre tomado del recuadro de datos de los planos técnicos), los tokens en tema claro y oscuro, el manual de marca y 13 componentes con vista previa. Comprueba con un script el contraste WCAG de cada par de colores: corrige un borde de control que no llegaba a 3:1 y separa el beige de aviso del amarillo de las coincidencias. Corrige en su propio ejemplo de Tailwind una referencia circular entre tokens |
| Bloque 5a: frontend (búsqueda, visor, login) | Autoriza el bloque tras confirmar las decisiones del sistema de diseño | Genera el proyecto con el scaffold oficial de Vite, los tokens de Cajetín en Tailwind, los componentes, las pantallas y 28 pruebas. Verifica el stack completo a través del proxy de Vite (login, carga, búsqueda, original y SSE). Corrige varios fallos propios detectados por el linter y las pruebas (ver abajo) |
| Bloque 5b: carga y estado en vivo | Autoriza el bloque | Genera la pantalla de carga (arrastrar y soltar, validación con los límites de la API, metadatos por lote y por archivo), el hook de estado en vivo por SSE, la actualización en vivo del detalle y 11 pruebas nuevas. Ejecuta las funciones reales del cliente contra la API real con Node (multipart, SSE, búsqueda, 401) |
| Etapa 3: medición de la latencia | Autoriza la etapa | Genera los scripts de siembra (pipeline real) y de benchmark (HTTP p50/p95, `Server-Timing`, concurrencia, `EXPLAIN` de la consulta exacta). La primera medición queda **fuera del objetivo** y se informa así. Diagnostica con el plan y tiempos aislados en psql, prueba y **descarta** dos hipótesis propias (vector reducido, compresión `lz4`), aplica `ts_rank` y el conteo con tope, y vuelve a medir en las mismas condiciones: p95 de 1 243 → 462 ms y, con 10 clientes, de 2 078 → 778 ms. Corrige una afirmación técnica errónea que había escrito antes sobre cómo escala el GIN |

## 3. Prompts clave y cómo se refinaron

Los prompts se muestran resumidos y con la redacción limpiada; el sentido es el original.

1. **Planificación inicial.**
   > "Analiza el documento de instrucciones técnicas y plantea el plan de trabajo. Actúa como desarrollador senior: documenta y sustenta el porqué de cada decisión técnica."

   *Refinamiento:* "Revisa el PDF del enunciado y audita si lo planteado coincide con lo que pide." Esto convirtió el plan en una tabla de discrepancias entre el enunciado y el documento técnico, que se resolvieron una a una.

2. **Forma de trabajo.**
   > "Necesito ir auditando y entendiendo lo que se va haciendo."

   *Resultado:* entregas por bloques, cada una con una guía de auditoría, y ningún avance sin aprobación.

3. **Trazabilidad técnica.**
   > "De lo que se vaya haciendo, registra las tecnologías implementadas en cada etapa y la documentación que haga falta explicar."

   *Resultado:* un registro técnico por etapa (conceptos, decisiones, problemas, evidencia), que es la base de `architecture.md` y de este documento.

4. **Commits.**
   > "Dame un mensaje de commit más detallado, que describa lo que se implementó."

   *Refinamiento:* tras revisar el historial, los mensajes se pasan con `git commit -F` para que no se trunquen.

5. **Migración SQL.**
   > "Escríbela tú, pero déjala bien explicada."

   *Resultado:* la migración con la justificación de cada columna, restricción e índice (por qué FTS y no `LIKE`, GIN frente a GiST, `TEXT` + `CHECK` frente a `ENUM`).

6. **Auditoría de entrega.**
   > "Actúa como desarrollador auditor y valida si cumplimos la estructura de entrega del punto 5 del PDF, y si es coherente con el documento técnico."

   *Resultado:* hallazgos priorizados que motivaron adelantar `README.md`, `architecture.md` y este documento.

## 4. Validación humana y control de calidad

### Mecanismos de control aplicados
- **Aprobación por bloque.** Ningún bloque se considera cerrado sin la revisión del desarrollador de su guía de auditoría.
- **Decisiones reservadas al desarrollador:** alcance, nombres de estado, política de credenciales, duración del token, estructura de archivos y gestión del historial de Git.
- **Control de versiones manual.** Todos los commits y push los ejecuta el desarrollador. La IA solo propone el mensaje.
- **Auditorías solicitadas expresamente** sobre la coherencia del plan con el enunciado y sobre la estructura de entrega.

### Errores de la IA detectados por las pruebas o la revisión
- La prueba del umbral de tamaño detectó que un archivo de exactamente 10 MB se rechazaba (busboy corta al alcanzar el límite). Se corrigió.
- Una aserción de prueba no comprobaba nada (`length >= 0`) y se reemplazó por una real.
- El valor de ejemplo de `JWT_SECRET` en `.env.example` habría superado la validación de longitud y permitido arrancar con un secreto público. Ahora se deja vacío.
- Dos afirmaciones de la documentación técnica no estaban comprobadas y se matizaron para que solo digan lo verificado.
- Una prueba manual dejó una fila en la base de datos de la demo, y se eliminó.
- La concurrencia del worker se leía en un decorador, que se evalúa antes de cargar `.env`, así que el valor configurado se ignoraba. Ahora se fija al arrancar.
- El worker registraba "indexado" aunque el `UPDATE` no afectara ninguna fila. Ahora comprueba el número de filas afectadas.
- Una limitación documentada sobre Redis caído no estaba comprobada y se reformuló para que solo diga lo verificado.
- La IA filtraba la salida de las pruebas para mostrar solo los totales, y eso ocultaba un aviso de la consola. Lo detectó el desarrollador al ejecutar las pruebas por su cuenta.
- Dos pruebas de búsqueda partían de supuestos incorrectos: que el fragmento incluiría un texto concreto y que un comentario no contaría como uso de `LIKE`. Se corrigieron tras analizar la salida real de `ts_headline` en psql.
- Al detener una prueba manual, un proceso de la API quedó vivo unos segundos. Se verificó por puerto y por línea de comandos que no quedara ningún proceso.
- Frontend: el efecto que devolvía el foco a los resultados dependía de un objeto recreado en cada render y habría robado el foco mientras se escribía. Se corrigió al revisar los avisos del linter.
- Frontend: una prueba detectó que el cajetín repetía "Indexado" (estado y rótulo de fecha) y que las fechas salían como "28 de oct de 2026" en lugar del formato del sistema de diseño. Se corrigieron ambos y se añadió la prueba de fechas que faltaba.
- Frontend: un enlace "Volver" usaba un truco de tipos y habría sacado de la aplicación a quien llegara por un enlace directo. Se sustituyó por un enlace a la búsqueda de origen.
- La primera verificación del stack falló porque otra aplicación de la máquina ocupaba el puerto 3000. Se identificó el proceso sin detenerlo y se documentó cómo usar otro puerto (`API_URL`).
- Carga: el resumen del lote contaba mal los documentos listos y el distintivo de formato dependía de `File.type`, que puede venir vacío para `.md`. Se corrigieron en la revisión, antes de las pruebas.
- Carga: una prueba mostró que, con la sesión caducada, el login aparecía **sin** el aviso. React Router 8 aplica la navegación como transición y la ruta protegida redirigía antes. Se rediseñó con un estado `expired` en el contexto de sesión.
- La documentación afirmaba que "el índice GIN crece con el número de lexemas distintos, no con las filas". Era incorrecto: crece con el texto indexado, y el coste que escala es el ranking de las coincidencias. Se corrigió al preparar la sección de escalabilidad, antes de la medición que lo confirmó.
- Dos hipótesis de optimización de la IA (columna de ranking reducida y compresión `lz4`) resultaron inútiles o contraproducentes al medirlas, y se revirtieron sin llegar al código.
- La validación del README en una copia limpia detectó que el ejemplo `curl` de carga guardaba los títulos con tildes dañados en Windows (`curl` convierte los argumentos a la página de códigos del sistema). Se confirmó la causa, se cambió el ejemplo para leer la operación de un archivo y la API ahora rechaza los metadatos con el carácter de reemplazo `�`.
- Al añadir esa validación, una edición con `sed` dejó la expresión regular como `/^[^FFFD]*$/`, que habría rechazado cualquier texto con una F o una D. Se detectó al revisar el archivo y se corrigió antes de ejecutar las pruebas; una prueba nueva acepta "Guía FAQ" y la etiqueta "DFS".
- Un proceso `nest start --watch` lanzado por la IA en una verificación del Bloque 2 siguió vivo varias horas: al detener la tarea solo se cerró el proceso hijo. Se detectó al revisar los procesos al final del Bloque 5b. La herramienta no permitió cerrarlo desde la sesión y se pidió al desarrollador que lo cerrara.

### Verificaciones ejecutadas por el desarrollador
*(Registrar aquí las verificaciones que el desarrollador ejecute personalmente: comando, fecha y resultado.)*

| Fecha | Verificación | Resultado |
|---|---|---|
| 2026-10-28 09:22 | `npm run test:e2e` (backend, tras el Bloque 2b): login, tokens, límite de intentos, carga multipart y restricciones de la base | ✅ 2 archivos, 17/17 pruebas (`auth.e2e-spec.ts` 9, `upload.e2e-spec.ts` 8) en 12,8 s |
| 2026-10-28 09:47 | `vitest run test/indexing.e2e-spec.ts` (Bloque 2c): pesos A/B/C en TXT/MD/PDF, errores definitivos, límite del `tsvector`, idempotencia y reconciliación | ✅ 6/6 + 1 pendiente (PDF dañado). **Detectó en la salida un aviso `WARN [DataSourceNameRegistry]`** que la IA había pasado por alto al filtrar los resultados. Analizado: es esperado en la prueba (API y worker en el mismo proceso, cada uno con su conexión) y no aparece en producción; se documentó en la propia prueba |
