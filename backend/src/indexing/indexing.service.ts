import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { FileStorage } from '../common/file-storage.js';
import { DocumentStatusEvent } from '../events/document-status-event.js';
import { StatusPublisher } from '../events/status-publisher.service.js';
import { INDEXING_QUEUE, IndexingJob } from './indexing-queue.module.js';
import { ExtractionError, extractDocumentText } from './text-extraction.js';

// Lo que se publica como evento sale de la fila recién escrita, no de un valor calculado aparte.
const RETURNING_STATUS = 'id, status, content_indexed, error_message, updated_at';

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
  WHERE id = $1 AND status = 'PROCESANDO'
  RETURNING ${RETURNING_STATUS}`;

const MARK_ERROR_SQL = `
  UPDATE documents SET status = 'ERROR', error_message = $2, updated_at = now()
  WHERE id = $1 AND status = 'PROCESANDO'
  RETURNING ${RETURNING_STATUS}`;

type StatusRow = {
  id: string;
  status: DocumentStatusEvent['status'];
  content_indexed: boolean;
  error_message: string | null;
  updated_at: Date;
};

// SQLSTATE 54000: el texto supera el tamaño máximo de un tsvector (1 MB).
const PROGRAM_LIMIT_EXCEEDED = '54000';

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectQueue(INDEXING_QUEUE) private readonly queue: Queue<IndexingJob>,
    private readonly publisher: StatusPublisher,
    private readonly storage: FileStorage,
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
      const content = await this.storage.read(doc.storage_path).catch(() => {
        throw new ExtractionError('El archivo original no está disponible');
      });
      text = await extractDocumentText(content, doc.mime_type);
    } catch (error) {
      if (error instanceof ExtractionError) return this.markError(documentId, error.message);
      throw error;
    }

    try {
      // En UPDATE, TypeORM devuelve [filas, filasAfectadas]; sin filas = otro proceso ya lo cerró.
      const [[row]] = await this.db.query<[StatusRow[], number]>(MARK_INDEXED_SQL, [documentId, text]);
      if (!row) return;
      if (text) this.logger.log(`Documento ${documentId} indexado (${text.length} caracteres)`);
      else this.logger.warn(`Documento ${documentId} indexado solo por metadatos: sin texto extraíble`);
      await this.publish(row);
    } catch (error) {
      if ((error as { code?: string }).code === PROGRAM_LIMIT_EXCEEDED) {
        return this.markError(documentId, 'El documento tiene demasiado texto para indexarse');
      }
      throw error;
    }
  }

  async markError(documentId: string, message: string): Promise<void> {
    const [[row]] = await this.db.query<[StatusRow[], number]>(MARK_ERROR_SQL, [documentId, message]);
    if (!row) return;
    this.logger.warn(`Documento ${documentId} en ERROR: ${message}`);
    await this.publish(row);
  }

  private publish(row: StatusRow): Promise<void> {
    return this.publisher.publish({
      id: row.id,
      status: row.status,
      contentIndexed: row.content_indexed,
      errorMessage: row.error_message,
      updatedAt: row.updated_at.toISOString(),
    });
  }

  /**
   * Reencola lo que quedó en PROCESANDO sin trabajo (p. ej. Redis caído durante la carga).
   * El jobId = documentId evita duplicar los que ya están en la cola.
   */
  async requeuePending(): Promise<number> {
    const pending = await this.db.query<{ id: string }[]>(
      `SELECT id FROM documents WHERE status = 'PROCESANDO'`,
    );
    const requeued = await Promise.all(
      pending.map(({ id }) =>
        // Un fallo con un documento (p. ej. otra réplica lo reencoló a la vez) no impide recuperar el resto.
        this.requeue(id).catch((error: Error) => {
          this.logger.warn(`No se pudo reencolar ${id}: ${error.message}`);
          return false;
        }),
      ),
    );
    return requeued.filter(Boolean).length;
  }

  /**
   * BullMQ ignora add() si ya existe un trabajo con ese jobId en CUALQUIER estado, incluidos los
   * terminados o fallidos que se retienen (removeOnComplete/removeOnFail). Por eso:
   * - en cola o en curso → no se toca (ya se procesará);
   * - terminado, fallido o en un estado desconocido → se elimina y se encola de nuevo.
   */
  private async requeue(id: string): Promise<boolean> {
    const existing = await this.queue.getJob(id);
    if (existing) {
      const state = await existing.getState();
      if (!['completed', 'failed', 'unknown'].includes(state)) return false;
      await existing.remove();
    }
    await this.queue.add('index', { documentId: id }, { jobId: id });
    return true;
  }
}
