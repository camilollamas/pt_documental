import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Repository } from 'typeorm';
import { appConfig } from '../common/config.js';
import { SearchQueryDto } from '../search/search-query.dto.js';
import { SearchService } from '../search/search.service.js';
import { DocumentEntity } from './document.entity.js';
import { toDocumentView, toStatusView } from './document.view.js';

/** Búsqueda, detalle y visor: públicos (solo la carga exige ser administrador). */
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly searchService: SearchService,
    @InjectRepository(DocumentEntity) private readonly documents: Repository<DocumentEntity>,
  ) {}

  @Get()
  async search(
    @Query() { query, page, pageSize }: SearchQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const start = performance.now();
    const result = await this.searchService.search(query, page, pageSize);
    // Tiempo de base de datos visible en el navegador/benchmark, separado de la latencia HTTP total.
    res.setHeader('Server-Timing', `db;dur=${(performance.now() - start).toFixed(1)}`);
    return result;
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return toDocumentView(await this.findOrFail(id));
  }

  @Get(':id/status')
  async status(@Param('id', ParseUUIDPipe) id: string) {
    return toStatusView(await this.findOrFail(id));
  }

  /**
   * Sirve el archivo original para verlo en el navegador (PDF embebido, MD/TXT como texto).
   * sendFile aporta Range (PDF.js carga por partes), ETag y Last-Modified.
   */
  @Get(':id/original')
  async original(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    const doc = await this.findOrFail(id);
    const isText = doc.mimeType.startsWith('text/');

    res.setHeader('Content-Type', isText ? `${doc.mimeType}; charset=utf-8` : doc.mimeType);
    res.setHeader('Content-Disposition', contentDisposition(doc.originalFilename, download === '1'));
    // El navegador respeta el tipo declarado y no intenta "adivinar" HTML en un .txt.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    res.sendFile(join(appConfig().storageDir, doc.storagePath), (error) => {
      if (error && !res.headersSent) {
        res.status(404).json({ statusCode: 404, message: 'El archivo original no está disponible' });
      }
    });
  }

  private async findOrFail(id: string): Promise<DocumentEntity> {
    const doc = await this.documents.findOneBy({ id });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    return doc;
  }
}

/** RFC 6266: nombre ASCII de respaldo + nombre UTF-8 completo en filename*. */
function contentDisposition(filename: string, attachment: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${attachment ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
