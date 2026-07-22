/**
 * Tipos compartidos — La Guantera
 *
 * "Documento crudo" es el formato interno comun al que TODAS las fuentes de
 * ingesta (GitHub, Telegram manual, y en Fase 2 n8n/Notion/Claude Code)
 * transforman su contenido antes de entrar al pipeline:
 * chequeo de secretos → chunking → embeddings → guantera_chunks.
 */

export type SourceType = 'github' | 'notion' | 'n8n' | 'telegram_manual' | 'claude_code';

/** Lista runtime de SourceType — para validar entrada externa (API, colector). */
export const SOURCE_TYPES: readonly SourceType[] = [
  'github',
  'notion',
  'n8n',
  'telegram_manual',
  'claude_code',
];

/** Contenido de una fuente, tal cual, antes de chunking. */
export interface DocumentoCrudo {
  sourceType: SourceType;
  /** Identificador estable en la fuente: SHA de commit, `repo:ruta` de archivo, id de mensaje, etc. */
  sourceId: string;
  /** Link directo a la fuente original, cuando exista. */
  sourceUrl?: string;
  /** Contenido exacto, sin resumir. */
  contenido: string;
  /** 'codigo' usa chunking por archivo/funcion; 'texto' por parrafo (ver BRIEF 7.2). */
  tipoContenido: 'codigo' | 'texto';
  /** repo, autor, fecha, tags, etc. segun sourceType. Va a la columna jsonb `metadata`. */
  metadata: Record<string, unknown>;
}

/** Fragmento de un documento, listo para embeber y guardar. */
export interface Chunk {
  sourceType: SourceType;
  sourceId: string;
  sourceUrl?: string;
  contenido: string;
  /** sha256 hex del contenido — clave del anti re-embedding (BRIEF 7.3). */
  contentHash: string;
  /** Posicion del chunk dentro de su documento (0-based). */
  chunkIndex: number;
  metadata: Record<string, unknown>;
}

/** Chunk ya embebido, listo para insertar en guantera_chunks. */
export interface ChunkConEmbedding extends Chunk {
  embedding: number[];
}

/** Filtros opcionales de busqueda (Fase 2): por fuente y rango de fecha de indexado. */
export interface FiltrosBusqueda {
  fuentes?: SourceType[];
  /** ISO 8601 — filtra por created_at del chunk. */
  desde?: string;
  hasta?: string;
}

/** Resultado de una busqueda semantica en guantera_chunks. */
export interface ResultadoBusqueda {
  id: string;
  contenido: string;
  sourceType: SourceType;
  sourceId: string;
  sourceUrl?: string;
  metadata: Record<string, unknown>;
  /** Similitud coseno (1 = identico). */
  similitud: number;
}
