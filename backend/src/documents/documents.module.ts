import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentEntity } from './document.entity.js';
import { DocumentsService } from './documents.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentEntity])],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
