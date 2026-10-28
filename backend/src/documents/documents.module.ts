import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IndexingQueueModule } from '../indexing/indexing-queue.module.js';
import { DocumentEntity } from './document.entity.js';
import { DocumentsService } from './documents.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentEntity]), IndexingQueueModule],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
