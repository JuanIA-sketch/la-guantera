import { describe, expect, test, vi } from 'vitest';
import {
  embeberChunks,
  embeberTexto,
  MODELO_EMBEDDINGS,
  type ClienteEmbeddings,
} from '../../src/procesamiento/embeddings.js';
import type { Chunk } from '../../src/tipos.js';

function chunkFalso(n: number): Chunk {
  return {
    sourceType: 'github',
    sourceId: `commit-${n}`,
    contenido: `contenido del chunk ${n}`,
    contentHash: `hash-${n}`,
    chunkIndex: 0,
    metadata: {},
  };
}

/** Cliente falso: devuelve un vector [n, n, n] por cada input, en orden. */
function clienteFalso() {
  const create = vi.fn(async ({ input }: { model: string; input: string | string[] }) => {
    const textos = Array.isArray(input) ? input : [input];
    return {
      data: textos.map((_, index) => ({ index, embedding: [index, index, index] })),
    };
  });
  return { cliente: { embeddings: { create } } as ClienteEmbeddings, create };
}

describe('embeberChunks', () => {
  test('adjunta a cada chunk su embedding, en el orden de entrada', async () => {
    const { cliente } = clienteFalso();
    const chunks = [chunkFalso(1), chunkFalso(2)];
    const { embebidos, omitidos } = await embeberChunks(chunks, { cliente });
    expect(omitidos).toBe(0);
    expect(embebidos).toHaveLength(2);
    expect(embebidos[0].contentHash).toBe('hash-1');
    expect(embebidos[0].embedding).toEqual([0, 0, 0]);
    expect(embebidos[1].embedding).toEqual([1, 1, 1]);
  });

  test('usa el modelo text-embedding-3-small', async () => {
    const { cliente, create } = clienteFalso();
    await embeberChunks([chunkFalso(1)], { cliente });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: MODELO_EMBEDDINGS })
    );
    expect(MODELO_EMBEDDINGS).toBe('text-embedding-3-small');
  });

  test('parte la carga en lotes segun maxPorLote', async () => {
    const { cliente, create } = clienteFalso();
    const chunks = [1, 2, 3, 4, 5].map(chunkFalso);
    const { embebidos } = await embeberChunks(chunks, { cliente, maxPorLote: 2 });
    expect(create).toHaveBeenCalledTimes(3);
    expect(embebidos).toHaveLength(5);
  });

  test('omite chunks cuyo contentHash ya existe (anti re-embedding) sin llamar a la API por ellos', async () => {
    const { cliente, create } = clienteFalso();
    const chunks = [chunkFalso(1), chunkFalso(2), chunkFalso(3)];
    const { embebidos, omitidos } = await embeberChunks(chunks, {
      cliente,
      hashesExistentes: new Set(['hash-1', 'hash-3']),
    });
    expect(omitidos).toBe(2);
    expect(embebidos).toHaveLength(1);
    expect(embebidos[0].contentHash).toBe('hash-2');
    const inputsEnviados = create.mock.calls.flatMap(([params]) =>
      Array.isArray(params.input) ? params.input : [params.input]
    );
    expect(inputsEnviados).toEqual(['contenido del chunk 2']);
  });

  test('si todos los hashes ya existen no llama a la API en absoluto', async () => {
    const { cliente, create } = clienteFalso();
    const { embebidos, omitidos } = await embeberChunks([chunkFalso(1)], {
      cliente,
      hashesExistentes: new Set(['hash-1']),
    });
    expect(create).not.toHaveBeenCalled();
    expect(embebidos).toEqual([]);
    expect(omitidos).toBe(1);
  });

  test('reintenta ante un 429 y termina bien si el reintento funciona', async () => {
    let llamadas = 0;
    const create = vi.fn(async ({ input }: { model: string; input: string | string[] }) => {
      llamadas++;
      if (llamadas === 1) throw Object.assign(new Error('rate limit'), { status: 429 });
      const textos = Array.isArray(input) ? input : [input];
      return { data: textos.map((_, index) => ({ index, embedding: [7] })) };
    });
    const cliente = { embeddings: { create } } as ClienteEmbeddings;
    const { embebidos } = await embeberChunks([chunkFalso(1)], {
      cliente,
      esperaBaseMs: 1,
    });
    expect(llamadas).toBe(2);
    expect(embebidos[0].embedding).toEqual([7]);
  });

  test('tras agotar los reintentos propaga el error', async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error('rate limit'), { status: 429 });
    });
    const cliente = { embeddings: { create } } as ClienteEmbeddings;
    await expect(
      embeberChunks([chunkFalso(1)], { cliente, reintentos: 2, esperaBaseMs: 1 })
    ).rejects.toThrow('rate limit');
    expect(create).toHaveBeenCalledTimes(3); // intento original + 2 reintentos
  });

  test('un error no reintentable (400) se propaga de inmediato, sin reintentos', async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error('bad request'), { status: 400 });
    });
    const cliente = { embeddings: { create } } as ClienteEmbeddings;
    await expect(
      embeberChunks([chunkFalso(1)], { cliente, esperaBaseMs: 1 })
    ).rejects.toThrow('bad request');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('embeberTexto', () => {
  test('devuelve el vector de un texto suelto (para embeber preguntas del bot)', async () => {
    const { cliente } = clienteFalso();
    const vector = await embeberTexto('donde quedo la decision del indice HNSW?', cliente);
    expect(vector).toEqual([0, 0, 0]);
  });
});
