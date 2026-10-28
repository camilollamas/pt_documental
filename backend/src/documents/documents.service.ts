import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import type { FileUpload } from 'graphql-upload/processRequest.mjs';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { appConfig } from '../common/config.js';
import { FileStorage } from '../common/file-storage.js';
import { INDEXING_QUEUE, IndexingJob } from '../indexing/indexing-queue.module.js';
import { DocumentStatus } from './document-status.js';
import { DocumentEntity } from './document.entity.js';
import { DocumentUploadResult } from './dto/document-upload-result.type.js';
import { DocumentMetadataInput } from './dto/upload-documents.input.js';
import { ALLOWED_EXTENSIONS, contentProblem, mimeFromFilename, sanitizeFilename } from './file-validation.js';

/** Un archivo rechazado: se informa en su fila del resultado y el resto del lote sigue. */
class Rejected extends Error {}

/**
 * Carga de un lote: cada archivo pasa por recibir → validar contenido → registrar → encolar.
 * Un fallo afecta solo a su archivo; el resultado es una fila por archivo (id + PROCESANDO, o error).
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documents: Repository<DocumentEntity>,
    @InjectQueue(INDEXING_QUEUE)
    private readonly indexingQueue: Queue<IndexingJob>,
    private readonly storage: FileStorage,
  ) {}

  async upload(files: Promise<FileUpload>[], documents: DocumentMetadataInput[]): Promise<DocumentUploadResult[]> {
    if (files.length !== documents.length) {
      throw new BadRequestException(
        `Se recibieron ${files.length} archivos y ${documents.length} metadatos; deben coincidir uno a uno.`,
      );
    }
    // ponytail: secuencial; con el límite de archivos por lote no compensa paralelizar la escritura a disco.
    const results: DocumentUploadResult[] = [];
    for (const [i, file] of files.entries()) {
      results.push(await this.storeOne(await file, documents[i]));
    }
    return results;
  }

  private async storeOne(upload: FileUpload, metadata: DocumentMetadataInput): Promise<DocumentUploadResult> {
    const filename = sanitizeFilename(upload.filename);
    // Clave en disco = UUID: impredecible y sin relación con el nombre enviado (evita path traversal).
    const id = randomUUID();
    try {
      const mime = mimeFromFilename(filename);
      if (!mime) throw new Rejected(`Formato no admitido. Extensiones válidas: ${ALLOWED_EXTENSIONS.join(', ')}`);
      const size = await this.receive(id, upload, mime);
      await this.register(id, filename, mime, size, metadata);
    } catch (error) {
      if (error instanceof Rejected) return { filename, error: error.message };
      throw error;
    }
    await this.enqueue(id);
    return { filename, id, status: DocumentStatus.PROCESANDO };
  }

  /** Guarda el archivo y comprueba su contenido real. Devuelve su tamaño en bytes. */
  private async receive(id: string, upload: FileUpload, mime: string): Promise<number> {
    let content: Buffer;
    try {
      await this.storage.save(id, upload.createReadStream());
      content = await this.storage.read(id);
    } catch (error) {
      await this.storage.remove(id);
      const tooLarge = (error as { status?: number }).status === 413;
      const maxMb = (appConfig().maxUploadBytes / 1024 / 1024).toFixed(1);
      throw new Rejected(tooLarge ? `El archivo supera el tamaño máximo de ${maxMb} MB` : 'No se pudo recibir el archivo');
    }
    const problem = contentProblem(mime, content);
    if (problem) {
      await this.storage.remove(id);
      throw new Rejected(problem);
    }
    return content.length;
  }

  /**
   * Inserta el documento en PROCESANDO. Si falla, se borra el archivo (sin registro quedaría huérfano)
   * y se rechaza SOLO este archivo: los anteriores del lote ya están guardados y encolados, y fallar
   * la mutación entera invitaría a reenviarlos (duplicados).
   */
  private async register(id: string, filename: string, mime: string, size: number, metadata: DocumentMetadataInput) {
    try {
      await this.documents.insert({
        id,
        title: metadata.title,
        author: metadata.author,
        category: metadata.category,
        tags: metadata.tags,
        version: metadata.version,
        originalFilename: filename,
        mimeType: mime,
        storagePath: id,
        sizeBytes: size,
        status: DocumentStatus.PROCESANDO,
      });
    } catch (dbError) {
      await this.storage.remove(id);
      this.logger.error(`No se pudo registrar ${filename}: ${(dbError as Error).message}`);
      throw new Rejected('No se pudo registrar el documento. Vuelva a subir solo este archivo.');
    }
  }

  private async enqueue(id: string) {
    try {
      // jobId = id del documento: encolar dos veces el mismo documento no crea dos trabajos.
      await this.indexingQueue.add('index', { documentId: id }, { jobId: id });
    } catch (queueError) {
      // El registro ya existe en PROCESANDO: el worker lo reencola al arrancar (requeuePending).
      this.logger.error(`No se pudo encolar ${id}: ${(queueError as Error).message}`);
    }
  }
}
