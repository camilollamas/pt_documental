import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DocumentStatus } from './document-status.js';

/**
 * Mapeo de la tabla creada por la migración (synchronize está desactivado: el esquema
 * lo define el SQL, no esta clase). `extracted_text` y `search_vector` no se cargan por
 * defecto porque pueden pesar megas y solo los usa el worker y la búsqueda.
 */
@Entity('documents')
export class DocumentEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('text')
  title: string;

  @Column('text')
  author: string;

  @Column('text')
  category: string;

  @Column('text', { array: true, default: () => `'{}'` })
  tags: string[];

  @Column('text')
  version: string;

  @Column('text', { name: 'original_filename' })
  originalFilename: string;

  @Column('text', { name: 'mime_type' })
  mimeType: string;

  /** Relativa a STORAGE_DIR. Nunca se expone por la API. */
  @Column('text', { name: 'storage_path' })
  storagePath: string;

  // bigint llega de pg como string para no perder precisión; 10 MB cabe de sobra en number.
  @Column('bigint', { name: 'size_bytes', transformer: { to: (v) => v, from: Number } })
  sizeBytes: number;

  @Column('text', { default: DocumentStatus.PROCESANDO })
  status: DocumentStatus;

  @Column('text', { name: 'extracted_text', nullable: true, select: false })
  extractedText: string | null;

  @Column('tsvector', { name: 'search_vector', nullable: true, select: false })
  searchVector: string | null;

  @Column('text', { name: 'error_message', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column('timestamptz', { name: 'indexed_at', nullable: true })
  indexedAt: Date | null;
}
