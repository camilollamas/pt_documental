// Siembra documentos técnicos sintéticos para medir la búsqueda con volumen.
//   npm run seed                 → 10 000 documentos (o SEED_COUNT)
//   npm run seed -- --clean      → borra los sembrados (etiqueta "semilla")
// Los indexa el pipeline real: filas PROCESANDO + archivo en STORAGE_DIR + trabajo en la cola.
// Requiere el worker en marcha (npm run start:worker) y el build (npm run build: reutiliza la conexión
// a Redis de la aplicación). Reproducible: misma semilla, mismos textos.
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { redisOptions } from '../dist/common/redis.js';

try {
  process.loadEnvFile();
} catch {
  // sin .env: valores por defecto o variables del entorno
}

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://docs:docs_local@localhost:5432/documents';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const STORAGE_DIR = resolve(process.env.STORAGE_DIR ?? './storage');
const COUNT = Number(process.env.SEED_COUNT ?? 10_000);
const TAG = 'semilla';

// --- Corpus: términos de dominio (algunos de varias palabras) y lenguaje de unión -------------
const TERMS = [
  'kubernetes', 'docker', 'nginx', 'postgres', 'redis', 'kafka', 'grafana', 'prometheus', 'kibana', 'elasticsearch',
  'terraform', 'ansible', 'helm', 'jenkins', 'gitlab', 'oauth', 'jwt', 'tls', 'certificado', 'firewall',
  'latencia', 'rendimiento', 'despliegue', 'replicación', 'particionado', 'índice', 'consulta', 'transacción',
  'respaldo', 'restauración', 'migración', 'monitoreo', 'alerta', 'incidente', 'escalado', 'contenedor', 'clúster',
  'microservicio', 'api', 'endpoint', 'webhook', 'cola', 'worker', 'caché', 'sesión', 'autenticación', 'autorización',
  'auditoría', 'cifrado', 'vpn', 'dns', 'proxy', 'balanceador', 'nodo', 'volumen', 'snapshot', 'pipeline',
  'integración continua', 'alta disponibilidad', 'balanceo de carga', 'copia de seguridad', 'recuperación ante desastres',
  'base de datos', 'tiempo de respuesta', 'control de versiones', 'gestión de secretos', 'red privada',
  'pg_dump', 'systemd', 'cron', 'ssh', 'grpc', 'graphql', 'rest', 'json', 'yaml', 'csv', 'sla', 'slo', 'rto', 'rpo',
  'manual', 'procedimiento', 'arquitectura', 'especificación', 'runbook', 'checklist', 'guía', 'política', 'norma',
];
const GLUE = [
  'de', 'la', 'el', 'en', 'y', 'para', 'con', 'los', 'las', 'se', 'por', 'del', 'una', 'un', 'que', 'antes', 'después',
  'configurar', 'verificar', 'revisar', 'ejecutar', 'actualizar', 'documentar', 'aplicar', 'validar', 'reiniciar',
  'servidor', 'servicio', 'sistema', 'entorno', 'producción', 'pruebas', 'equipo', 'operación', 'cambio', 'error',
  'registro', 'parámetro', 'archivo', 'usuario', 'permiso', 'puerto', 'versión', 'paso', 'resultado', 'estado',
  'the', 'and', 'to', 'of', 'with', 'for', 'is', 'on', 'deploy', 'check', 'run', 'config', 'service', 'server',
];
const AUTHORS = ['Equipo SRE', 'DBA', 'Infraestructura', 'Seguridad', 'Arquitectura', 'Plataforma', 'Soporte N2', 'QA'];
const CATEGORIES = ['Manual', 'Guía', 'Procedimiento', 'Especificación', 'Runbook', 'Política'];

/** PRNG determinista (mulberry32): la misma semilla produce el mismo corpus en cualquier máquina. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(20261028);
const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)];

/** Ley de Zipf: el término de rango k aparece con probabilidad ∝ 1/k, como en un texto real. */
function zipf(list: string[]) {
  let sum = 0;
  const cumulative = list.map((_, i) => (sum += 1 / (i + 1)));
  const total = sum;
  return () => {
    const r = random() * total;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return list[lo];
  };
}
const term = zipf(TERMS);
const glue = zipf(GLUE);

/** Tamaño: 70 % de 2 a 10 KB, 25 % de 10 a 50 KB, 5 % de 50 a 200 KB. */
function targetBytes() {
  const r = random();
  const [min, max] = r < 0.7 ? [2_000, 10_000] : r < 0.95 ? [10_000, 50_000] : [50_000, 200_000];
  return Math.floor(min + random() * (max - min));
}

function makeDocument(i: number) {
  const ref = `ref${String(i).padStart(5, '0')}`; // término único: consulta selectiva de 1 resultado
  const title = `${pick(CATEGORIES)} de ${term()} y ${term()}`;
  const tags = [...new Set([term(), term(), TAG])].map((t) => t.slice(0, 40));
  const target = targetBytes();
  const lines = [`# ${title}`, '', `Referencia interna ${ref}.`, ''];
  let size = 0;
  while (size < target) {
    const words = Array.from({ length: 12 + Math.floor(random() * 12) }, () => (random() < 0.35 ? term() : glue()));
    const sentence = words.join(' ') + '.';
    lines.push(sentence);
    size += sentence.length + 1;
  }
  return { title, tags, text: lines.join('\n'), author: pick(AUTHORS), category: pick(CATEGORIES), version: `${1 + (i % 4)}.${i % 10}` };
}

// --- Ejecución -------------------------------------------------------------------------------
const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

if (process.argv.includes('--clean')) {
  const { rows } = await db.query(`DELETE FROM documents WHERE $1 = ANY(tags) RETURNING storage_path`, [TAG]);
  await Promise.all(rows.map((r) => rm(join(STORAGE_DIR, r.storage_path), { force: true })));
  console.log(`Eliminados ${rows.length} documentos sembrados.`);
  await db.end();
  process.exit(0);
}

const queue = new Queue('indexing', { connection: redisOptions(REDIS_URL) });
await mkdir(STORAGE_DIR, { recursive: true });
console.log(`Sembrando ${COUNT} documentos en ${DATABASE_URL.replace(/:[^:@/]+@/, ':***@')} …`);

const started = performance.now();
let bytes = 0;
const BATCH = 500;
for (let offset = 0; offset < COUNT; offset += BATCH) {
  const batch = Array.from({ length: Math.min(BATCH, COUNT - offset) }, (_, k) => ({ id: randomUUID(), ...makeDocument(offset + k) }));
  await Promise.all(batch.map((d) => writeFile(join(STORAGE_DIR, d.id), d.text)));
  bytes += batch.reduce((sum, d) => sum + Buffer.byteLength(d.text), 0);
  await db.query(
    `INSERT INTO documents (id, title, author, category, tags, version, original_filename, mime_type, storage_path, size_bytes)
     SELECT d.id::uuid, d.title, d.author, d.category, string_to_array(d.tags, '|'), d.version, d.filename, 'text/markdown', d.id, d.size
     FROM json_to_recordset($1::json) AS d(id text, title text, author text, category text, tags text, version text, filename text, size bigint)`,
    [JSON.stringify(batch.map((d) => ({ ...d, tags: d.tags.join('|'), filename: `semilla-${d.id.slice(0, 8)}.md`, size: Buffer.byteLength(d.text) })))],
  );
  await queue.addBulk(batch.map((d) => ({ name: 'index', data: { documentId: d.id }, opts: { jobId: d.id, removeOnComplete: true } })));
  process.stdout.write(`\r  insertados y encolados: ${offset + batch.length}/${COUNT}`);
}
const inserted = performance.now();
console.log(`\n  ${(bytes / 1024 / 1024).toFixed(1)} MB de texto en ${((inserted - started) / 1000).toFixed(1)} s. Esperando al worker…`);

for (;;) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE status = 'PROCESANDO')::int AS pending, count(*) FILTER (WHERE status = 'ERROR')::int AS failed
     FROM documents WHERE $1 = ANY(tags)`,
    [TAG],
  );
  process.stdout.write(`\r  pendientes de indexar: ${rows[0].pending}      `);
  if (rows[0].pending === 0) {
    const seconds = (performance.now() - inserted) / 1000;
    console.log(`\n  Indexados en ${seconds.toFixed(1)} s (${(COUNT / seconds).toFixed(0)} docs/s). Con error: ${rows[0].failed}.`);
    break;
  }
  await new Promise((r) => setTimeout(r, 2_000));
}

await queue.close();
await db.end();
