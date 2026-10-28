import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { InjectRepository } from '@nestjs/typeorm';
import type { FileUpload } from 'graphql-upload/processRequest.mjs';
import { Repository } from 'typeorm';
import { appConfig } from '../common/config.js';
import { DocumentStatus } from './document-status.js';
import { DocumentEntity } from './document.entity.js';
import { DocumentUploadResult } from './dto/document-upload-result.type.js';
import { DocumentMetadataInput } from './dto/upload-documents.input.js';
import {
  ALLOWED_EXTENSIONS,
  contentMatchesMime,
  mimeFromFilename,
  sanitizeFilename,
} from './file-validation.js';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documents: Repository<DocumentEntity>,
  ) {}

  async upload(
    files: Promise<FileUpload>[],
    documents: DocumentMetadataInput[],
  ): Promise<DocumentUploadResult[]> {
    if (files.length !== documents.length) {
      throw new BadRequestException(
        `Se recibieron ${files.length} archivos y ${documents.length} metadatos; deben coincidir uno a uno.`,
      );
    }
    const { storageDir } = appConfig();
    await mkdir(storageDir, { recursive: true });

    // ponytail: secuencial; con el límite de archivos por lote no compensa paralelizar la escritura a disco.
    const results: DocumentUploadResult[] = [];
    for (const [i, file] of files.entries()) {
      results.push(await this.storeOne(await file, documents[i], storageDir));
    }
    return results;
  }

  private async storeOne(
    upload: FileUpload,
    metadata: DocumentMetadataInput,
    storageDir: string,
  ): Promise<DocumentUploadResult> {
    const filename = sanitizeFilename(upload.filename);
    const mime = mimeFromFilename(filename);
    if (!mime) {
      return {
        filename,
        error: `Formato no admitido. Extensiones válidas: ${ALLOWED_EXTENSIONS.join(', ')}`,
      };
    }

    // Nombre en disco = UUID: impredecible y sin relación con el nombre enviado (evita path traversal).
    const id = randomUUID();
    const storagePath = join(storageDir, id);
    try {
      await pipeline(upload.createReadStream(), createWriteStream(storagePath));
    } catch (error) {
      await rm(storagePath, { force: true });
      const tooLarge = (error as { status?: number }).status === 413;
      const maxMb = (appConfig().maxUploadBytes / 1024 / 1024).toFixed(1);
      return {
        filename,
        error: tooLarge
          ? `El archivo supera el tamaño máximo de ${maxMb} MB`
          : 'No se pudo recibir el archivo',
      };
    }

    const content = await readFile(storagePath);
    const error =
      content.length === 0
        ? 'El archivo está vacío'
        : !contentMatchesMime(mime, content)
          ? 'El contenido del archivo no corresponde a su extensión'
          : undefined;
    if (error) {
      await rm(storagePath, { force: true });
      return { filename, error };
    }

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
        sizeBytes: content.length,
        status: DocumentStatus.PROCESANDO,
      });
    } catch (dbError) {
      // Sin registro el archivo quedaría huérfano en disco.
      await rm(storagePath, { force: true });
      throw dbError;
    }

    // Bloque 2c: encolar la indexación.
    return { filename, id, status: DocumentStatus.PROCESANDO };
  }
}
