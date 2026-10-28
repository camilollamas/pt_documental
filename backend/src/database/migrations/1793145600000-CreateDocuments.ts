import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SQL escrito a mano (no generado por el ORM): el índice GIN, el tipo tsvector y los CHECK
 * son el núcleo de la búsqueda y deben quedar explícitos y revisables.
 */
export class CreateDocuments1793145600000 implements MigrationInterface {
  name = 'CreateDocuments1793145600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE documents (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        title             TEXT NOT NULL,
        author            TEXT NOT NULL,
        category          TEXT NOT NULL,
        tags              TEXT[] NOT NULL DEFAULT '{}',
        version           TEXT NOT NULL,

        original_filename TEXT NOT NULL,
        mime_type         TEXT NOT NULL,
        storage_path      TEXT NOT NULL,
        size_bytes        BIGINT NOT NULL CHECK (size_bytes > 0),

        status            TEXT NOT NULL DEFAULT 'PROCESANDO'
                          CONSTRAINT documents_status_check
                          CHECK (status IN ('PROCESANDO', 'INDEXADO', 'ERROR')),

        extracted_text    TEXT,
        search_vector     TSVECTOR,
        error_message     TEXT,

        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        indexed_at        TIMESTAMPTZ,

        -- Un documento no puede figurar como INDEXADO si su índice no está escrito.
        CONSTRAINT documents_indexed_has_vector
          CHECK (status <> 'INDEXADO' OR (search_vector IS NOT NULL AND indexed_at IS NOT NULL))
      )
    `);

    // Índice invertido: cada lexema apunta a las filas que lo contienen. Es lo que permite
    // resolver "search_vector @@ tsquery" sin recorrer la tabla (lo contrario de LIKE '%x%').
    await queryRunner.query(
      `CREATE INDEX documents_search_vector_idx ON documents USING GIN (search_vector)`,
    );

    // Listados recientes y desempate estable de la paginación.
    await queryRunner.query(
      `CREATE INDEX documents_created_at_idx ON documents (created_at DESC, id DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE documents`);
  }
}
