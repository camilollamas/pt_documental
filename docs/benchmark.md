# Medición de la búsqueda

> Generado por `backend/scripts/benchmark.ts` el 2026-10-28 20:01 UTC. Reproducible con `npm run seed` + `npm run benchmark`.

## Resultado

**p95 HTTP secuencial: 370.5 ms · p95 con 10 clientes concurrentes: 778.3 ms** frente al objetivo del enunciado (400 ms – 1 s, leído como máximo de 1 s): **dentro del objetivo**.

## Entorno

| | |
|---|---|
| Máquina | Intel(R) Core(TM) Ultra 7 165H · 22 hilos · 31 GB RAM · win32 10.0.26200 |
| API | Node v22.22.0, `node dist/main.js` (build de producción), 1 proceso |
| Base de datos | PostgreSQL 18.6 on x86_64-pc-linux-musl en Docker (imagen `postgres:18-alpine`, configuración por defecto) |
| Corpus | 10000 documentos (10000 indexados), 175 MB de texto extraído, índice GIN de 4352 kB. Generado con `npm run seed` (vocabulario técnico con distribución de Zipf, 2–200 KB por documento) |
| Cliente | Mismo equipo que el servidor (sin latencia de red). 30 mediciones por consulta tras 3 de calentamiento |

## Latencia por tipo de consulta (un cliente)

HTTP = desde que se envía la petición hasta leer la respuesta completa. BD = cabecera `Server-Timing` (tiempo de la consulta en la API).

| Consulta | `query` | Resultados | HTTP p50 (ms) | HTTP p95 (ms) | HTTP máx (ms) | BD p50 (ms) | BD p95 (ms) |
|---|---|---|---|---|---|---|---|
| Término frecuente | `kubernetes` | > 1000 | 252.7 | 277.2 | 321.9 | 250.8 | 274.8 |
| Dos términos (AND) | `despliegue kubernetes` | > 1000 | 315.8 | 417.5 | 504.8 | 313.7 | 415.0 |
| Frase exacta | `"balanceo de carga"` | > 1000 | 355.0 | 462.1 | 511.1 | 353.0 | 459.5 |
| Selectiva (1 documento) | `ref04217` | 1 | 4.0 | 4.6 | 4.7 | 2.7 | 3.0 |
| Alternativa (OR) | `grafana or kibana` | > 1000 | 203.9 | 293.5 | 316.9 | 202.0 | 290.7 |
| Exclusión | `postgres -replicación` | 671 | 27.2 | 35.6 | 41.1 | 25.0 | 33.0 |
| Sin resultados | `zzzinexistente` | 0 | 2.4 | 3.4 | 5.8 | 1.4 | 2.0 |
| Página 50 (OFFSET 490) | `kubernetes` | > 1000 | 283.3 | 343.3 | 349.8 | 281.0 | 340.5 |
| **Todas** | | | **238.8** | **370.5** | **511.1** | 236.1 | 368.3 |

## Carga concurrente

10 clientes × 20 búsquedas, repartidas entre las consultas anteriores: **p50 425.0 ms · p95 778.3 ms · máx 854.1 ms** · 26 búsquedas/s.

## Plan de ejecución

`EXPLAIN (ANALYZE, BUFFERS)` de la consulta exacta de la API (`SEARCH_SQL`) para `kubernetes`. Usa el índice GIN (`Bitmap Index Scan on documents_search_vector_idx`): no hay recorrido secuencial de la tabla.

```text
Incremental Sort (actual time=270.836..270.840 rows=10.00 loops=1)
  Sort Key: (ts_rank(d_1.search_vector, q_1.query)) DESC, d.created_at DESC, d.id DESC
  Presorted Key: (ts_rank(d_1.search_vector, q_1.query))
  Full-sort Groups: 1  Sort Method: quicksort  Average Memory: 31kB  Peak Memory: 31kB
  Buffers: shared hit=37140
  CTE q
    ->  Result (actual time=0.001..0.002 rows=1.00 loops=1)
  ->  Nested Loop (actual time=213.401..270.724 rows=10.00 loops=1)
        Buffers: shared hit=37128
        ->  Nested Loop (actual time=208.405..208.502 rows=10.00 loops=1)
              Buffers: shared hit=37081
              ->  Limit (actual time=208.387..208.395 rows=10.00 loops=1)
                    Buffers: shared hit=37051
                    ->  Sort (actual time=208.385..208.391 rows=10.00 loops=1)
                          Sort Key: (ts_rank(d_1.search_vector, q_1.query)) DESC, d_1.created_at DESC, d_1.id DESC
                          Sort Method: top-N heapsort  Memory: 26kB
                          Buffers: shared hit=37051
                          ->  Nested Loop (actual time=1.721..204.218 rows=10000.00 loops=1)
                                Buffers: shared hit=37051
                                ->  CTE Scan on q q_1 (actual time=0.004..0.006 rows=1.00 loops=1)
                                      Storage: Memory  Maximum Storage: 17kB
                                ->  Bitmap Heap Scan on documents d_1 (actual time=1.510..7.659 rows=10000.00 loops=1)
                                      Recheck Cond: (search_vector @@ q_1.query)
                                      Filter: (status = 'INDEXADO'::text)
                                      Heap Blocks: exact=694
                                      Buffers: shared hit=700
                                      ->  Bitmap Index Scan on documents_search_vector_idx (actual time=1.428..1.428 rows=10000.00 loops=1)
                                            Index Cond: (search_vector @@ q_1.query)
                                            Index Searches: 1
                                            Buffers: shared hit=6
              ->  Index Scan using documents_pkey on documents d (actual time=0.008..0.008 rows=1.00 loops=10)
                    Index Cond: (id = d_1.id)
                    Index Searches: 10
                    Buffers: shared hit=30
        ->  CTE Scan on q (actual time=0.000..0.001 rows=1.00 loops=10)
              Storage: Memory  Maximum Storage: 17kB
Planning:
  Buffers: shared hit=348
Planning Time: 3.027 ms
Execution Time: 271.040 ms
```

## Historial de optimización

La primera medición quedó fuera del objetivo en las consultas amplias (p95 de hasta 1 243 ms; 2 078 ms con 10 clientes). El diagnóstico, los experimentos descartados y el cambio aplicado están en `docs/architecture.md` → "Latencia: medición y optimización".

## Límites de esta medición

- Cliente y servidor en la misma máquina: no incluye latencia de red.
- PostgreSQL con la configuración por defecto de la imagen Docker, sin ajustes de memoria.
- Corpus sintético: su distribución de términos imita un texto real, pero no es documentación real.
