# Uso de Inteligencia Artificial

> Documento vivo: se actualiza al cerrar cada bloque con lo que realmente ocurrió.

## 1. Herramientas utilizadas

| Herramienta | Uso |
|---|---|
| **Claude Code** (modelo Claude Opus 5.5), extensión de VS Code | Asistente de desarrollo: análisis del enunciado, planificación, generación de código y pruebas, diagnóstico de errores y redacción de documentación |
| **Context7** (servidor MCP de documentación) | Consulta de la documentación vigente de TypeORM 1.x para no usar APIs obsoletas |

## 2. Casos de uso por etapa

| Etapa | Qué hizo la IA | Qué hizo el desarrollador |
|---|---|---|
| Análisis y planificación | Leyó el enunciado (PDF) y el documento de aclaraciones. Propuso un plan por bloques y una matriz requisito → implementación → prueba. Auditó la coherencia entre ambos documentos | Definió el stack y las aclaraciones de alcance. Decidió usar los estados del enunciado (`PROCESANDO`/`INDEXADO`/`ERROR`) frente a los nombres en inglés propuestos |
| Bloque 1: carga GraphQL multipart | Generó el esqueleto NestJS, la mutación de carga, la validación de archivos y las pruebas. Diagnosticó el bug de npm 10, el conflicto de versiones `graphql`/`graphql-upload` y el corte de busboy en el límite exacto | Revisó el bloque, hizo el commit y pidió un mensaje de commit más detallado |
| Bloque 2a: persistencia | Generó `docker-compose.yml`, la migración SQL, la entidad y las pruebas contra PostgreSQL real. Documentó la migración línea por línea | Fijó las decisiones de credenciales (hash en `.env`), duración del JWT (8 h) y puerto (5432). Pidió que la migración viniera explicada para poder defenderla. Movió `.env.example` a `backend/` |
| Auditoría de estructura | Contrastó el repositorio con el punto 5 del enunciado. Detectó la documentación faltante, el `.gitignore` sin versionar y el mensaje truncado del primer commit | Solicitó la auditoría, creó el repositorio remoto y ordenó aplicar las recomendaciones |

## 3. Prompts clave y cómo se refinaron

1. **Planificación.** *"Crea un archivo .claude con indicaciones internas para realizar lo que está en AGENTS_TECH_LEAD_KATA.md, actuando como desarrollador senior… analiza el documento y plantea el plan de trabajo."* Se refinó con: *"el PDF está en la carpeta .claude para que audites si coincide lo planteado con lo que indica"*. Eso llevó a una tabla de discrepancias entre el PDF y el plan.
2. **Forma de trabajo.** Se pidió avanzar por bloques auditables, entendiendo cada parte antes de continuar. De ahí salió el flujo: bloque pequeño → guía de auditoría (qué hace, por qué, alternativas, cómo probarlo, preguntas de sustentación) → visto bueno → siguiente bloque.
3. **Documentación del proceso.** *"De lo que se vaya haciendo, tecnologías implementadas en cada etapa… déjalo en un archivo .md"*. Resultado: un registro técnico interno por etapa, que es la base de este documento y de `architecture.md`.
4. **Migración SQL.** *"Hazlo tú y lo dejas bien explicado"*. Resultado: la migración con la explicación de cada columna, restricción e índice.
5. **Auditoría.** *"Actúa como desarrollador experto auditor y valida si estamos cumpliendo con el punto 5 del PDF"*. Resultado: los hallazgos que motivaron este esqueleto documental.

## 4. Validación humana

- **Ejecución verificable.** Cada bloque se entrega con comandos reproducibles (`npm test`, `npm run test:e2e`, `curl` contra el servidor y `\d documents` en PostgreSQL) y sus resultados.
- **Pruebas que encontraron errores reales:**
  - La prueba del umbral de tamaño detectó que un archivo de exactamente 10 MB se rechazaba (busboy corta al alcanzar el límite).
  - En la revisión del Bloque 2a se encontró una aserción que no comprobaba nada (`length >= 0`) y se reemplazó por una real.
- **Afirmaciones técnicas verificadas en la base de datos** antes de documentarlas: el ejemplo de `tsvector` y la volatilidad de `array_to_string`.
- **Decisiones de alcance del desarrollador:** estados del enunciado, valores por defecto de autenticación, ubicación de `.env.example`, exclusión de la carpeta de trabajo de la IA del repositorio.
- **Control de versiones manual:** los commits los realiza el desarrollador, no la IA.

*(Se completa en cada bloque.)*
