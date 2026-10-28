import { DocumentEntity } from './document.entity.js';

/** Lo que la API expone de un documento: nunca la ruta física (storage_path) ni el texto completo. */
export function toDocumentView(doc: DocumentEntity) {
  return {
    id: doc.id,
    title: doc.title,
    author: doc.author,
    category: doc.category,
    tags: doc.tags,
    version: doc.version,
    originalFilename: doc.originalFilename,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    status: doc.status,
    contentIndexed: doc.contentIndexed,
    errorMessage: doc.errorMessage,
    createdAt: doc.createdAt,
    indexedAt: doc.indexedAt,
  };
}

export function toStatusView(doc: DocumentEntity) {
  return {
    id: doc.id,
    status: doc.status,
    contentIndexed: doc.contentIndexed,
    errorMessage: doc.errorMessage,
    updatedAt: doc.updatedAt,
  };
}
