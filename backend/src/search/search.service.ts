import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  FRAGMENT_SEPARATOR,
  HighlightSegment,
  MATCH_END,
  MATCH_START,
  parseHighlight,
  parseSnippets,
} from './highlight.js';

// ts_headline vuelve a analizar el texto en cada llamada: se limita a esta longitud para que el
// coste no crezca con el tamaño del documento. Una coincidencia más allá no se resalta en el
// fragmento (el documento sí aparece en los resultados: el filtro usa el índice completo).
const HEADLINE_MAX_CHARS = 50_000;

const TITLE_HEADLINE_OPTIONS = `HighlightAll=true,StartSel=${MATCH_START},StopSel=${MATCH_END}`;
const SNIPPET_HEADLINE_OPTIONS =
  `StartSel=${MATCH_START},StopSel=${MATCH_END},MaxFragments=2,MaxWords=30,MinWords=12,` +
  `FragmentDelimiter=${FRAGMENT_SEPARATOR}`;

/**
 * - websearch_to_tsquery acepta texto de usuario sin errores de sintaxis: términos, "frase exacta",
 *   OR y -exclusión. Nunca se usa LIKE/ILIKE: el filtro es `@@` sobre el índice GIN.
 * - La página se elige primero (CTE `page`) y ts_headline, que es caro, solo se calcula para esas filas.
 * - Orden estable: a igual relevancia decide created_at e id, así una fila no salta entre páginas.
 */
const SEARCH_SQL = `
  WITH q AS (SELECT websearch_to_tsquery('simple', $1) AS query),
  page AS (
    SELECT d.id, ts_rank_cd(d.search_vector, q.query) AS rank, count(*) OVER () AS total
    FROM documents d, q
    WHERE d.status = 'INDEXADO' AND d.search_vector @@ q.query
    ORDER BY rank DESC, d.created_at DESC, d.id DESC
    LIMIT $2 OFFSET $3
  )
  SELECT d.id, d.title, d.author, d.category, d.tags, d.version, d.mime_type,
         d.original_filename, d.size_bytes, d.content_indexed, d.created_at, d.indexed_at,
         page.rank, page.total,
         ts_headline('simple', d.title, q.query, $4) AS title_highlight,
         ts_headline('simple', coalesce(left(d.extracted_text, ${HEADLINE_MAX_CHARS}), ''), q.query, $5)
           AS content_highlight
  FROM page JOIN documents d USING (id), q
  ORDER BY page.rank DESC, d.created_at DESC, d.id DESC`;

const COUNT_SQL = `
  SELECT count(*) AS total FROM documents
  WHERE status = 'INDEXADO' AND search_vector @@ websearch_to_tsquery('simple', $1)`;

type SearchRow = {
  id: string;
  title: string;
  author: string;
  category: string;
  tags: string[];
  version: string;
  mime_type: string;
  original_filename: string;
  size_bytes: string;
  content_indexed: boolean;
  created_at: Date;
  indexed_at: Date;
  rank: number;
  total: string;
  title_highlight: string;
  content_highlight: string;
};

export type SearchResultItem = {
  id: string;
  title: string;
  titleHighlight: HighlightSegment[];
  snippets: HighlightSegment[][];
  author: string;
  category: string;
  tags: string[];
  version: string;
  mimeType: string;
  originalFilename: string;
  sizeBytes: number;
  contentIndexed: boolean;
  createdAt: Date;
  indexedAt: Date;
  rank: number;
};

export type SearchResult = {
  items: SearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
};

@Injectable()
export class SearchService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async search(query: string, page: number, pageSize: number): Promise<SearchResult> {
    if (!query) return { items: [], total: 0, page, pageSize };

    const rows = await this.db.query<SearchRow[]>(SEARCH_SQL, [
      query,
      pageSize,
      (page - 1) * pageSize,
      TITLE_HEADLINE_OPTIONS,
      SNIPPET_HEADLINE_OPTIONS,
    ]);

    // Página fuera de rango: no hay filas de las que leer el total, se cuenta aparte.
    const total = rows.length
      ? Number(rows[0].total)
      : page > 1
        ? Number((await this.db.query(COUNT_SQL, [query]))[0].total)
        : 0;

    return { items: rows.map(toItem), total, page, pageSize };
  }
}

function toItem(row: SearchRow): SearchResultItem {
  return {
    id: row.id,
    title: row.title,
    titleHighlight: parseHighlight(row.title_highlight),
    snippets: row.content_indexed ? parseSnippets(row.content_highlight) : [],
    author: row.author,
    category: row.category,
    tags: row.tags,
    version: row.version,
    mimeType: row.mime_type,
    originalFilename: row.original_filename,
    sizeBytes: Number(row.size_bytes),
    contentIndexed: row.content_indexed,
    createdAt: row.created_at,
    indexedAt: row.indexed_at,
    rank: row.rank,
  };
}
