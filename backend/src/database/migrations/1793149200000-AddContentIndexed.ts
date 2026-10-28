import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Distingue los documentos INDEXADOS cuyo contenido se pudo extraer de los que solo se
 * indexaron por título y metadatos (PDF escaneado sin OCR, archivo sin texto).
 * Decisión del propietario: esos documentos se indexan igual, pero quedan identificados.
 */
export class AddContentIndexed1793149200000 implements MigrationInterface {
  name = 'AddContentIndexed1793149200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE documents
        ADD COLUMN content_indexed BOOLEAN NOT NULL DEFAULT false,
        -- Si dice que el contenido está indexado, el texto extraído debe existir.
        ADD CONSTRAINT documents_content_indexed_has_text
          CHECK (NOT content_indexed OR extracted_text IS NOT NULL)
    `);
    // Filas existentes: indexadas con texto → contenido indexado.
    await queryRunner.query(`
      UPDATE documents SET content_indexed = true
      WHERE status = 'INDEXADO' AND extracted_text IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE documents
        DROP CONSTRAINT documents_content_indexed_has_text,
        DROP COLUMN content_indexed
    `);
  }
}
