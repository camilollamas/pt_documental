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
| **Context7** (servidor MCP de documentación) | Consulta de la documentación vigente de TypeORM 1.x para no usar APIs obsoletas |

## 2. Casos de uso por etapa

| Etapa | Dirección y decisiones del desarrollador | Aporte de la IA |
|---|---|---|
| Análisis y planificación | Aporta el documento técnico (stack, restricciones, estructura y reglas). Pide contrastar el plan con el enunciado oficial. Detectada la discrepancia en los nombres de estado, **decide usar los literales del enunciado** (`PROCESANDO`/`INDEXADO`/`ERROR`) | Lee el enunciado y el documento técnico, propone un plan por bloques y una matriz requisito → implementación → prueba, y señala las diferencias entre ambos documentos |
| Bloque 1: carga GraphQL multipart | Define la carga por GraphQL multipart con metadatos. Revisa el bloque, gestiona el commit y exige un mensaje de commit que describa con detalle lo implementado | Genera el esqueleto NestJS, la mutación, la validación de archivos y las pruebas. Diagnostica un bug de npm 10, un conflicto de versiones `graphql`/`graphql-upload` y el corte de busboy en el límite exacto de tamaño |
| Bloque 2a: persistencia | Fija la política de credenciales (hash en el entorno, nunca en claro), la duración del token (8 h, sin refresh) y el puerto de PostgreSQL. Exige que la migración SQL venga **explicada línea por línea** para poder defenderla. Reubica `.env.example` en `backend/` | Genera `docker-compose.yml`, la migración (índice GIN, `CHECK` de estados), la entidad y las pruebas contra PostgreSQL real |
| Auditoría de estructura | Pide una **auditoría** del repositorio contra el punto 5 del enunciado. Crea el repositorio remoto y ordena adelantar la documentación obligatoria | Contrasta la estructura, detecta la documentación faltante, el `.gitignore` sin versionar y un mensaje de commit truncado, y propone correcciones |
| Bloque 2b: login del administrador | Valida el diseño de autenticación. Decide **no reescribir** el historial de Git, priorizando avanzar | Genera el módulo de autenticación, el script de hash y las pruebas. Detecta que el guard actúa después de recibir los archivos y añade un middleware previo |
| Bloque 2c: cola e indexación | Ejecuta las pruebas e2e del bloque anterior y aporta la evidencia antes de autorizar el avance. **Decide el tratamiento de los documentos sin texto extraíble** (PDF escaneado): rechaza dejarlos en `ERROR`, que era la propuesta inicial, y pide indexarlos por metadatos **marcados** para poder identificarlos. Ese cambio introdujo la segunda migración (`content_indexed`). Se le ofreció escribir la prueba "PDF dañado → `ERROR` sin detener el worker" y delegó su redacción en la IA | Genera la cola BullMQ, el worker separado, la extracción con `unpdf` y la indexación con pesos A/B/C. Detecta y corrige dos fallos propios: la concurrencia leída antes de cargar `.env` y un log de "indexado" que no comprobaba las filas afectadas. Verifica el límite de 1 MB del `tsvector` en PostgreSQL antes de documentarlo. Escribe, a petición del desarrollador, la prueba del PDF dañado dentro de un lote con un documento válido |

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

### Verificaciones ejecutadas por el desarrollador
*(Registrar aquí las verificaciones que el desarrollador ejecute personalmente: comando, fecha y resultado.)*

| Fecha | Verificación | Resultado |
|---|---|---|
| 2026-10-28 09:22 | `npm run test:e2e` (backend, tras el Bloque 2b): login, tokens, límite de intentos, carga multipart y restricciones de la base | ✅ 2 archivos, 17/17 pruebas (`auth.e2e-spec.ts` 9, `upload.e2e-spec.ts` 8) en 12,8 s |
| 2026-10-28 09:47 | `vitest run test/indexing.e2e-spec.ts` (Bloque 2c): pesos A/B/C en TXT/MD/PDF, errores definitivos, límite del `tsvector`, idempotencia y reconciliación | ✅ 6/6 + 1 pendiente (PDF dañado). **Detectó en la salida un aviso `WARN [DataSourceNameRegistry]`** que la IA había pasado por alto al filtrar los resultados. Analizado: es esperado en la prueba (API y worker en el mismo proceso, cada uno con su conexión) y no aparece en producción; se documentó en la propia prueba |
