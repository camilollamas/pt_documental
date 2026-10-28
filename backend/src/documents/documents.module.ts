import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileStorage } from '../common/file-storage.js';
import { IndexingQueueModule } from '../indexing/indexing-queue.module.js';
import { SearchService } from '../search/search.service.js';
import { DocumentEntity } from './document.entity.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentEntity]), IndexingQueueModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, SearchService, FileStorage],
  exports: [DocumentsService],
})
export class DocumentsModule {}
