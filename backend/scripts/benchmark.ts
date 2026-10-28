// Mide la latencia de búsqueda: HTTP de extremo a extremo frente al tiempo de base de datos (Server-Timing),
// y el plan de ejecución de la consulta EXACTA de la API. Escribe el informe en ../docs/benchmark.md.
//   npm run build && npm run benchmark        (API en marcha, datos sembrados con npm run seed)
// Variables: API_URL (http://localhost:3000), DATABASE_URL, BENCH_RUNS (30).
import { cpus, totalmem, platform, release } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
// El SQL real de la API (compilado en dist/): se explica la misma consulta que se mide.
import { SEARCH_SQL, SNIPPET_HEADLINE_OPTIONS, TITLE_HEADLINE_OPTIONS } from '../dist/search/search.service.js';

try {
  process.loadEnvFile();
} catch {
  // sin .env
}

const API_URL = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://docs:docs_local@localhost:5432/documents';
const RUNS = Number(process.env.BENCH_RUNS ?? 30);
const WARMUP = 3;
const TARGET_MS = 1000;

const QUERIES: [string, string, number?][] = [
  ['kubernetes', 'Término frecuente'],
  ['despliegue kubernetes', 'Dos términos (AND)'],
  ['"balanceo de carga"', 'Frase exacta'],
  ['ref04217', 'Selectiva (1 documento)'],
  ['grafana or kibana', 'Alternativa (OR)'],
  ['postgres -replicación', 'Exclusión'],
  ['zzzinexistente', 'Sin resultados'],
  ['kubernetes', 'Página 50 (OFFSET 490)', 50],
];

type Sample = { http: number; db: number };

async function measure(query: string, page = 1): Promise<Sample & { total: string }> {
  const url = `${API_URL}/api/documents?${new URLSearchParams({ query, page: String(page), pageSize: '10' })}`;
  const start = performance.now();
  const res = await fetch(url);
  const body = await res.json(); // el tiempo incluye recibir y leer el cuerpo completo
  const http = performance.now() - start;
  if (!res.ok) throw new Error(`${res.status} en ${url}`);
  const db = Number(/db;dur=([\d.]+)/.exec(res.headers.get('server-timing') ?? '')?.[1] ?? NaN);
  return { http, db, total: `${body.totalCapped ? "> " : ""}${body.total}` };
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const ms = (v: number) => v.toFixed(1);
const stats = (samples: Sample[]) => {
  const http = samples.map((s) => s.http);
  const db = samples.map((s) => s.db);
  return { p50: percentile(http, 50), p95: percentile(http, 95), max: Math.max(...http), db50: percentile(db, 50), db95: percentile(db, 95) };
};

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const corpus = (
  await db.query(`SELECT count(*)::int AS docs, count(*) FILTER (WHERE status = 'INDEXADO')::int AS indexed,
                         pg_size_pretty(sum(octet_length(extracted_text))) AS text,
                         pg_size_pretty(pg_relation_size('documents_search_vector_idx')) AS gin,
                         version() AS pg FROM documents`)
).rows[0];
console.log(`Corpus: ${corpus.docs} documentos (${corpus.indexed} indexados), ${corpus.text} de texto, índice GIN ${corpus.gin}`);

// 1. Secuencial: un cliente, RUNS mediciones por consulta tras WARMUP de calentamiento.
const rows: string[] = [];
const all: Sample[] = [];
for (const [query, label, page] of QUERIES) {
  for (let i = 0; i < WARMUP; i++) await measure(query, page);
  const samples: (Sample & { total: string })[] = [];
  for (let i = 0; i < RUNS; i++) samples.push(await measure(query, page));
  all.push(...samples);
  const s = stats(samples);
  rows.push(`| ${label} | \`${query}\` | ${samples[0].total} | ${ms(s.p50)} | ${ms(s.p95)} | ${ms(s.max)} | ${ms(s.db50)} | ${ms(s.db95)} |`);
  console.log(`${label.padEnd(28)} p50 ${ms(s.p50).padStart(7)} ms · p95 ${ms(s.p95).padStart(7)} ms · bd p50 ${ms(s.db50)} ms`);
}
const overall = stats(all);

// 2. Concurrente: 10 clientes simultáneos repartiendo las consultas.
const CLIENTS = 10;
const PER_CLIENT = 20;
const concurrentStart = performance.now();
const concurrent = (
  await Promise.all(
    Array.from({ length: CLIENTS }, async (_, c) => {
      const out: Sample[] = [];
      for (let i = 0; i < PER_CLIENT; i++) {
        const [query, , page] = QUERIES[(c + i) % QUERIES.length];
        out.push(await measure(query, page));
      }
      return out;
    }),
  )
).flat();
const concurrentSeconds = (performance.now() - concurrentStart) / 1000;
const cs = stats(concurrent);
console.log(`Concurrente ${CLIENTS}×${PER_CLIENT}: p50 ${ms(cs.p50)} ms · p95 ${ms(cs.p95)} ms · ${(concurrent.length / concurrentSeconds).toFixed(0)} búsquedas/s`);

// 3. Plan de ejecución de la consulta exacta de la API.
const plan = (
  await db.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) ${SEARCH_SQL}`, ['kubernetes', 10, 0, TITLE_HEADLINE_OPTIONS, SNIPPET_HEADLINE_OPTIONS])
).rows.map((r) => r['QUERY PLAN']).join('\n');
const usesGin = /Bitmap Index Scan on documents_search_vector_idx/.test(plan);
console.log(`Plan: ${usesGin ? 'usa el índice GIN (Bitmap Index Scan)' : 'NO usa el índice GIN'}`);
await db.end();

const within = overall.p95 <= TARGET_MS && cs.p95 <= TARGET_MS;
const report = `# Medición de la búsqueda

> Generado por \`backend/scripts/benchmark.ts\` el ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Reproducible con \`npm run seed\` + \`npm run benchmark\`.

## Resultado

**p95 HTTP secuencial: ${ms(overall.p95)} ms · p95 con ${CLIENTS} clientes concurrentes: ${ms(cs.p95)} ms** frente al objetivo del enunciado (400 ms – 1 s, leído como máximo de 1 s): ${within ? '**dentro del objetivo**' : '**FUERA del objetivo**'}.

## Entorno

| | |
|---|---|
| Máquina | ${cpus()[0].model.trim()} · ${cpus().length} hilos · ${(totalmem() / 1024 ** 3).toFixed(0)} GB RAM · ${platform()} ${release()} |
| API | Node ${process.version}, \`node dist/main.js\` (build de producción), 1 proceso |
| Base de datos | ${String(corpus.pg).split(',')[0]} en Docker (imagen \`postgres:18-alpine\`, configuración por defecto) |
| Corpus | ${corpus.docs} documentos (${corpus.indexed} indexados), ${corpus.text} de texto extraído, índice GIN de ${corpus.gin}. Generado con \`npm run seed\` (vocabulario técnico con distribución de Zipf, 2–200 KB por documento) |
| Cliente | Mismo equipo que el servidor (sin latencia de red). ${RUNS} mediciones por consulta tras ${WARMUP} de calentamiento |

## Latencia por tipo de consulta (un cliente)

HTTP = desde que se envía la petición hasta leer la respuesta completa. BD = cabecera \`Server-Timing\` (tiempo de la consulta en la API).

| Consulta | \`query\` | Resultados | HTTP p50 (ms) | HTTP p95 (ms) | HTTP máx (ms) | BD p50 (ms) | BD p95 (ms) |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}
| **Todas** | | | **${ms(overall.p50)}** | **${ms(overall.p95)}** | **${ms(overall.max)}** | ${ms(overall.db50)} | ${ms(overall.db95)} |

## Carga concurrente

${CLIENTS} clientes × ${PER_CLIENT} búsquedas, repartidas entre las consultas anteriores: **p50 ${ms(cs.p50)} ms · p95 ${ms(cs.p95)} ms · máx ${ms(cs.max)} ms** · ${(concurrent.length / concurrentSeconds).toFixed(0)} búsquedas/s.

## Plan de ejecución

\`EXPLAIN (ANALYZE, BUFFERS)\` de la consulta exacta de la API (\`SEARCH_SQL\`) para \`kubernetes\`. ${usesGin ? 'Usa el índice GIN (`Bitmap Index Scan on documents_search_vector_idx`): no hay recorrido secuencial de la tabla.' : 'No aparece el índice GIN.'}

\`\`\`text
${plan}
\`\`\`

## Historial de optimización

La primera medición quedó fuera del objetivo en las consultas amplias (p95 de hasta 1 243 ms; 2 078 ms con 10 clientes). El diagnóstico, los experimentos descartados y el cambio aplicado están en \`docs/architecture.md\` → "Latencia: medición y optimización".

## Límites de esta medición

- Cliente y servidor en la misma máquina: no incluye latencia de red.
- PostgreSQL con la configuración por defecto de la imagen Docker, sin ajustes de memoria.
- Corpus sintético: su distribución de términos imita un texto real, pero no es documentación real.
`;
const out = resolve('../docs/benchmark.md');
await writeFile(out, report);
console.log(`Informe: ${out}`);
