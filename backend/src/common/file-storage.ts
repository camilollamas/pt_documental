import { Injectable } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { appConfig } from './config.js';

/**
 * Único punto de acceso a los archivos originales (carga, worker y visor).
 * Hoy es un directorio local (STORAGE_DIR); pasar a almacenamiento de objetos (S3 o compatible)
 * es sustituir esta clase. `key` es lo que se guarda en documents.storage_path (relativo, sin ruta física).
 */
@Injectable()
export class FileStorage {
  private path(key: string): string {
    return join(appConfig().storageDir, key);
  }

  /** Guarda por streaming. Si falla (p. ej. límite de tamaño), no deja el archivo a medias. */
  async save(key: string, content: Readable): Promise<void> {
    await mkdir(appConfig().storageDir, { recursive: true });
    try {
      await pipeline(content, createWriteStream(this.path(key)));
    } catch (error) {
      await this.remove(key);
      throw error;
    }
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  remove(key: string): Promise<void> {
    return rm(this.path(key), { force: true });
  }

  /**
   * Ruta en disco para servir el original con res.sendFile (Range, ETag). Con almacenamiento
   * remoto se sustituiría por un stream o una URL firmada.
   */
  localPath(key: string): string {
    return this.path(key);
  }
}
