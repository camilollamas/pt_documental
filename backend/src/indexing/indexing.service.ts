import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { appConfig } from '../common/config.js';
import { INDEXING_QUEUE, IndexingJob } from './indexing-queue.module.js';
import { ExtractionError, extractDocumentText } from './text-extraction.js';

// Pesos: una coincidencia en el título (A) puntúa más que en metadatos (B) o en el contenido (C).
// Diccionario 'simple': sin stemming ni stopwords, válido para un corpus técnico multilingüe.
// Sin texto extraíble ($2 = ''), el documento se indexa solo por título y metadatos y queda
// marcado con content_indexed = false (decisión del propietario: no se descarta, se identifica).
const MARK_INDEXED_SQL = `
  UPDATE documents SET
    extracted_text = NULLIF($2, ''),
    content_indexed = ($2 <> ''),
    search_vector =
         setweight(to_tsvector('simple', title), 'A')
      || setweight(to_tsvector('simple', concat_ws(' ', author, category, version, array_to_string(tags, ' '))), 'B')
      || setweight(to_tsvector('simple', $2), 'C'),
    status = 'INDEXADO',
    error_message = NULL,
    indexed_at = now(),
    updated_at = now()
  WHERE id = $1 AND status = 'PROCESANDO'`;

const MARK_ERROR_SQL = `
  UPDATE documents SET status = 'ERROR', error_message = $2, updated_at = now()
  WHERE id = $1 AND status = 'PROCESANDO'`;

// SQLSTATE 54000: el texto supera el tamaño máximo de un tsvector (1 MB).
const PROGRAM_LIMIT_EXCEEDED = '54000';

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectQueue(INDEXING_QUEUE) private readonly queue: Queue<IndexingJob>,
  ) {}

  /**
   * Idempotente: solo actúa sobre documentos en PROCESANDO, así que un reintento o un trabajo
   * duplicado no reindexa ni pisa un estado final. Los errores transitorios (BD caída) se
   * relanzan para que BullMQ reintente; los del propio documento se marcan ERROR.
   */
  async index(documentId: string): Promise<void> {
    const [doc] = await this.db.query<{ mime_type: string; storage_path: string }[]>(
      `SELECT mime_type, storage_path FROM documents WHERE id = $1 AND status = 'PROCESANDO'`,
      [documentId],
    );
    if (!doc) return;

    let text: string;
    try {
      const content = await readFile(join(appConfig().storageDir, doc.storage_path)).catch(() => {
        throw new ExtractionError('El archivo original no está disponible');
      });
      text = await extractDocumentText(content, doc.mime_type);
    } catch (error) {
      if (error instanceof ExtractionError) return this.markError(documentId, error.message);
      throw error;
    }

    try {
      // En UPDATE, TypeORM devuelve [filas, filasAfectadas]; 0 = otro proceso ya lo cerró.
      const [, updated] = await this.db.query(MARK_INDEXED_SQL, [documentId, text]);
      if (updated && text) {
        this.logger.log(`Documento ${documentId} indexado (${text.length} caracteres)`);
      } else if (updated) {
        this.logger.warn(`Documento ${documentId} indexado solo por metadatos: sin texto extraíble`);
      }
    } catch (error) {
      if ((error as { code?: string }).code === PROGRAM_LIMIT_EXCEEDED) {
        return this.markError(documentId, 'El documento tiene demasiado texto para indexarse');
      }
      throw error;
    }
  }

  async markError(documentId: string, message: string): Promise<void> {
    const [, updated] = await this.db.query(MARK_ERROR_SQL, [documentId, message]);
    if (updated) this.logger.warn(`Documento ${documentId} en ERROR: ${message}`);
  }

  /**
   * Reencola lo que quedó en PROCESANDO sin trabajo (p. ej. Redis caído durante la carga).
   * El jobId = documentId evita duplicar los que ya están en la cola.
   */
  async requeuePending(): Promise<number> {
    const pending = await this.db.query<{ id: string }[]>(
      `SELECT id FROM documents WHERE status = 'PROCESANDO'`,
    );
    await Promise.all(
      pending.map(({ id }) => this.queue.add('index', { documentId: id }, { jobId: id })),
    );
    return pending.length;
  }
}
