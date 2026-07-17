import { describe, expect, test, vi } from 'vitest';
import { crearAlmacen } from '../../src/almacenamiento/supabase-client.js';
import type { ChunkConEmbedding } from '../../src/tipos.js';

function chunkEmbebido(n: number): ChunkConEmbedding {
  return {
    sourceType: 'github',
    sourceId: `sha-${n}`,
    sourceUrl: `https://github.com/x/y/commit/sha-${n}`,
    contenido: `contenido ${n}`,
    contentHash: `hash-${n}`,
    chunkIndex: 0,
    metadata: { repo: 'x/y' },
    embedding: [0.1, 0.2],
  };
}

describe('crearAlmacen', () => {
  describe('insertarChunks', () => {
    test('hace upsert ignorando duplicados sobre el indice unico y reporta insertados vs duplicados', async () => {
      const select = vi.fn(async () => ({ data: [{ id: 'nuevo-1' }], error: null }));
      const upsert = vi.fn(() => ({ select }));
      const from = vi.fn(() => ({ upsert }));
      const almacen = crearAlmacen({ from, rpc: vi.fn() });

      const resultado = await almacen.insertarChunks([chunkEmbebido(1), chunkEmbebido(2)]);

      expect(from).toHaveBeenCalledWith('guantera_chunks');
      expect(upsert).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            source_type: 'github',
            source_id: 'sha-1',
            source_url: 'https://github.com/x/y/commit/sha-1',
            content: 'contenido 1',
            content_hash: 'hash-1',
            chunk_index: 0,
            embedding: [0.1, 0.2],
            metadata: { repo: 'x/y' },
          }),
          expect.objectContaining({ source_id: 'sha-2' }),
        ],
        { onConflict: 'source_type,source_id,content_hash', ignoreDuplicates: true }
      );
      expect(resultado).toEqual({ insertados: 1, duplicados: 1 });
    });

    test('con lista vacia no toca la base', async () => {
      const from = vi.fn();
      const almacen = crearAlmacen({ from, rpc: vi.fn() });
      const resultado = await almacen.insertarChunks([]);
      expect(from).not.toHaveBeenCalled();
      expect(resultado).toEqual({ insertados: 0, duplicados: 0 });
    });

    test('un error de Supabase se propaga como excepcion', async () => {
      const select = vi.fn(async () => ({ data: null, error: { message: 'permiso denegado' } }));
      const from = vi.fn(() => ({ upsert: vi.fn(() => ({ select })) }));
      const almacen = crearAlmacen({ from, rpc: vi.fn() });
      await expect(almacen.insertarChunks([chunkEmbebido(1)])).rejects.toThrow('permiso denegado');
    });
  });

  describe('hashesExistentes', () => {
    test('devuelve el set de content_hash que ya estan en la tabla', async () => {
      const inFn = vi.fn(async () => ({
        data: [{ content_hash: 'hash-1' }, { content_hash: 'hash-3' }],
        error: null,
      }));
      const select = vi.fn(() => ({ in: inFn }));
      const from = vi.fn(() => ({ select }));
      const almacen = crearAlmacen({ from, rpc: vi.fn() });

      const existentes = await almacen.hashesExistentes(['hash-1', 'hash-2', 'hash-3']);

      expect(select).toHaveBeenCalledWith('content_hash');
      expect(inFn).toHaveBeenCalledWith('content_hash', ['hash-1', 'hash-2', 'hash-3']);
      expect(existentes).toEqual(new Set(['hash-1', 'hash-3']));
    });

    test('con lista vacia devuelve set vacio sin consultar', async () => {
      const from = vi.fn();
      const almacen = crearAlmacen({ from, rpc: vi.fn() });
      expect(await almacen.hashesExistentes([])).toEqual(new Set());
      expect(from).not.toHaveBeenCalled();
    });
  });

  describe('reemplazarChunksDeFuente', () => {
    test('borra los chunks viejos de esa fuente y despues inserta los nuevos', async () => {
      const orden: string[] = [];
      const eqSourceId = vi.fn(async () => {
        orden.push('delete');
        return { error: null };
      });
      const eqSourceType = vi.fn(() => ({ eq: eqSourceId }));
      const deleteFn = vi.fn(() => ({ eq: eqSourceType }));
      const select = vi.fn(async () => {
        orden.push('insert');
        return { data: [{ id: 'n1' }], error: null };
      });
      const upsert = vi.fn(() => ({ select }));
      const from = vi.fn(() => ({ delete: deleteFn, upsert }));
      const almacen = crearAlmacen({ from, rpc: vi.fn() });

      await almacen.reemplazarChunksDeFuente('github', 'x/y:src/a.ts', [chunkEmbebido(1)]);

      expect(eqSourceType).toHaveBeenCalledWith('source_type', 'github');
      expect(eqSourceId).toHaveBeenCalledWith('source_id', 'x/y:src/a.ts');
      expect(orden).toEqual(['delete', 'insert']);
    });
  });

  describe('buscarPorSimilitud', () => {
    test('invoca el RPC guantera_buscar y mapea las filas a ResultadoBusqueda', async () => {
      const rpc = vi.fn(async () => ({
        data: [
          {
            id: 'abc',
            content: 'Decidimos HNSW con vector_cosine_ops',
            source_type: 'github',
            source_id: 'sha-9',
            source_url: 'https://github.com/x/y/commit/sha-9',
            metadata: { repo: 'x/y' },
            similitud: 0.87,
          },
        ],
        error: null,
      }));
      const almacen = crearAlmacen({ from: vi.fn(), rpc });

      const resultados = await almacen.buscarPorSimilitud([0.5, 0.5], 5, 0.35);

      expect(rpc).toHaveBeenCalledWith('guantera_buscar', {
        query_embedding: [0.5, 0.5],
        limite: 5,
        umbral: 0.35,
      });
      expect(resultados).toEqual([
        {
          id: 'abc',
          contenido: 'Decidimos HNSW con vector_cosine_ops',
          sourceType: 'github',
          sourceId: 'sha-9',
          sourceUrl: 'https://github.com/x/y/commit/sha-9',
          metadata: { repo: 'x/y' },
          similitud: 0.87,
        },
      ]);
    });

    test('un error del RPC se propaga como excepcion', async () => {
      const rpc = vi.fn(async () => ({ data: null, error: { message: 'rpc no existe' } }));
      const almacen = crearAlmacen({ from: vi.fn(), rpc });
      await expect(almacen.buscarPorSimilitud([0.1], 5, 0.35)).rejects.toThrow('rpc no existe');
    });
  });
});
