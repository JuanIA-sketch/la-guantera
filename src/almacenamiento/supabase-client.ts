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
import WebSocket from 'ws';
import type { ChunkConEmbedding, FiltrosBusqueda, ResultadoBusqueda, SourceType } from '../tipos.js';

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
  // transport explicito: supabase-js inicializa su cliente Realtime aunque no se
  // use, y Node 20 (el del VPS) no trae WebSocket nativo — sin esto, falla al crear
  // el cliente con "Node.js 20 detected without native WebSocket support".
  // El cast es necesario: el tipo del constructor de `ws` difiere del WebSocket del DOM
  // que declara supabase-js, pero en runtime Realtime solo hace `new transport(url, protocols)`,
  // firma que `ws` soporta.
  return createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
  });
}

export interface AlmacenGuantera {
  insertarChunks(chunks: ChunkConEmbedding[]): Promise<{ insertados: number; duplicados: number }>;
  hashesExistentes(hashes: string[]): Promise<Set<string>>;
  reemplazarChunksDeFuente(
    sourceType: SourceType,
    sourceId: string,
    chunks: ChunkConEmbedding[]
  ): Promise<{ insertados: number; duplicados: number }>;
  buscarPorSimilitud(
    embedding: number[],
    limite: number,
    umbral: number,
    filtros?: FiltrosBusqueda
  ): Promise<ResultadoBusqueda[]>;
  /** source_id distintos ya guardados para una fuente — alimenta el sweep de borrados (Fase 2). */
  listarSourceIds(sourceType: SourceType): Promise<Set<string>>;
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

    async buscarPorSimilitud(embedding, limite, umbral, filtros) {
      const params: Record<string, unknown> = {
        query_embedding: embedding,
        limite,
        umbral,
      };
      // Solo los filtros presentes: los ausentes usan el default null del RPC.
      if (filtros?.fuentes !== undefined) params.fuentes = filtros.fuentes;
      if (filtros?.desde !== undefined) params.desde = filtros.desde;
      if (filtros?.hasta !== undefined) params.hasta = filtros.hasta;
      const { data, error } = await cliente.rpc('guantera_buscar', params);
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

    async listarSourceIds(sourceType) {
      const { data, error } = await cliente.from(TABLA).select('source_id').eq('source_type', sourceType);
      if (error) throw new Error(`Supabase (listar fuentes): ${error.message}`);
      return new Set((data ?? []).map((fila: { source_id: string }) => fila.source_id));
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
