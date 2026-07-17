/**
 * Almacenamiento en Supabase — La Guantera
 *
 * Reutiliza el MISMO proyecto de Supabase que ya usa charly-prospecting, con la
 * tabla separada `guantera_chunks` (ver scripts/schema.sql: indice HNSW con
 * vector_cosine_ops + indice unico anti-duplicados).
 *
 * - insertarChunks: upsert ignorando duplicados sobre (source_type, source_id,
 *   content_hash) — una re-sincronizacion no duplica filas.
 * - hashesExistentes: alimenta el filtro anti re-embedding de embeddings.ts.
 * - reemplazarChunksDeFuente: para snapshots de archivos que cambiaron
 *   (source_id = `repo:ruta`): borra los chunks viejos e inserta los nuevos.
 * - buscarPorSimilitud: RPC `guantera_buscar` (definida en schema.sql).
 */

import { createClient } from '@supabase/supabase-js';
import type { ChunkConEmbedding, ResultadoBusqueda, SourceType } from '../tipos.js';

const TABLA = 'guantera_chunks';
const CONFLICTO = 'source_type,source_id,content_hash';

/**
 * Subconjunto del cliente de supabase-js que usa este modulo — inyectable en
 * tests. La cadena de query-builder se tipa laxa a proposito: el contrato real
 * lo fijan los tests y el schema.
 */
export interface ClienteSupabaseMinimo {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabla: string): any;
  rpc(
    fn: string,
    params: Record<string, unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): PromiseLike<{ data: any; error: { message: string } | null }>;
}

export function crearClienteSupabase(): ClienteSupabaseMinimo {
  return createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '');
}

export interface AlmacenGuantera {
  insertarChunks(chunks: ChunkConEmbedding[]): Promise<{ insertados: number; duplicados: number }>;
  hashesExistentes(hashes: string[]): Promise<Set<string>>;
  reemplazarChunksDeFuente(
    sourceType: SourceType,
    sourceId: string,
    chunks: ChunkConEmbedding[]
  ): Promise<{ insertados: number; duplicados: number }>;
  buscarPorSimilitud(embedding: number[], limite: number, umbral: number): Promise<ResultadoBusqueda[]>;
}

export function crearAlmacen(cliente: ClienteSupabaseMinimo): AlmacenGuantera {
  return {
    async insertarChunks(chunks) {
      if (chunks.length === 0) return { insertados: 0, duplicados: 0 };
      const { data, error } = await cliente
        .from(TABLA)
        .upsert(chunks.map(aFila), { onConflict: CONFLICTO, ignoreDuplicates: true })
        .select('id');
      if (error) throw new Error(`Supabase (insertar): ${error.message}`);
      const insertados = (data ?? []).length;
      return { insertados, duplicados: chunks.length - insertados };
    },

    async hashesExistentes(hashes) {
      if (hashes.length === 0) return new Set();
      const { data, error } = await cliente.from(TABLA).select('content_hash').in('content_hash', hashes);
      if (error) throw new Error(`Supabase (hashes): ${error.message}`);
      return new Set((data ?? []).map((fila: { content_hash: string }) => fila.content_hash));
    },

    async reemplazarChunksDeFuente(sourceType, sourceId, chunks) {
      const { error } = await cliente
        .from(TABLA)
        .delete()
        .eq('source_type', sourceType)
        .eq('source_id', sourceId);
      if (error) throw new Error(`Supabase (borrar fuente): ${error.message}`);
      return this.insertarChunks(chunks);
    },

    async buscarPorSimilitud(embedding, limite, umbral) {
      const { data, error } = await cliente.rpc('guantera_buscar', {
        query_embedding: embedding,
        limite,
        umbral,
      });
      if (error) throw new Error(`Supabase (buscar): ${error.message}`);
      return (data ?? []).map(
        (fila: {
          id: string;
          content: string;
          source_type: SourceType;
          source_id: string;
          source_url: string | null;
          metadata: Record<string, unknown>;
          similitud: number;
        }): ResultadoBusqueda => ({
          id: fila.id,
          contenido: fila.content,
          sourceType: fila.source_type,
          sourceId: fila.source_id,
          sourceUrl: fila.source_url ?? undefined,
          metadata: fila.metadata,
          similitud: fila.similitud,
        })
      );
    },
  };
}

function aFila(chunk: ChunkConEmbedding) {
  return {
    source_type: chunk.sourceType,
    source_id: chunk.sourceId,
    source_url: chunk.sourceUrl ?? null,
    content: chunk.contenido,
    content_hash: chunk.contentHash,
    chunk_index: chunk.chunkIndex,
    embedding: chunk.embedding,
    metadata: chunk.metadata,
  };
}
