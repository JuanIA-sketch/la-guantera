import { describe, expect, test, vi } from 'vitest';
import { procesarDocumento, procesarDocumentos } from '../src/pipeline.js';
import type { AlmacenGuantera } from '../src/almacenamiento/supabase-client.js';
import type { ClienteEmbeddings } from '../src/procesamiento/embeddings.js';
import type { DocumentoCrudo } from '../src/tipos.js';

// Secreto sintetico para el test de rechazo (nunca una credencial real)
const CLAVE_FALSA = 'AKIA' + 'FAKEFAKEFAKEFAKE';

function docLimpio(contenido = 'Decidimos HNSW porque el volumen es personal.'): DocumentoCrudo {
  return {
    sourceType: 'telegram_manual',
    sourceId: 'telegram:1:1',
    contenido,
    tipoContenido: 'texto',
    metadata: {},
  };
}

function armarDeps(hashesYaGuardados: string[] = []) {
  const insertarChunks = vi.fn(async (chunks: unknown[]) => ({
    insertados: chunks.length,
    duplicados: 0,
  }));
  const reemplazarChunksDeFuente = vi.fn(async (_t: string, _s: string, chunks: unknown[]) => ({
    insertados: chunks.length,
    duplicados: 0,
  }));
  const hashesExistentes = vi.fn(async () => new Set(hashesYaGuardados));
  const almacen = {
    insertarChunks,
    hashesExistentes,
    reemplazarChunksDeFuente,
    buscarPorSimilitud: vi.fn(),
  } as unknown as AlmacenGuantera;

  const create = vi.fn(async ({ input }: { model: string; input: string | string[] }) => {
    const textos = Array.isArray(input) ? input : [input];
    return { data: textos.map((_, index) => ({ index, embedding: [0.5] })) };
  });
  const clienteEmbeddings = { embeddings: { create } } as ClienteEmbeddings;

  return { almacen, clienteEmbeddings, insertarChunks, reemplazarChunksDeFuente, hashesExistentes, create };
}

describe('procesarDocumento', () => {
  test('un documento con secreto se rechaza ANTES de chunking/embeddings/almacen', async () => {
    const deps = armarDeps();
    const resultado = await procesarDocumento(docLimpio(`la clave es ${CLAVE_FALSA}`), deps);
    expect(resultado.aceptado).toBe(false);
    if (!resultado.aceptado) {
      expect(resultado.patrones).toContain('aws_access_key');
    }
    expect(deps.create).not.toHaveBeenCalled();
    expect(deps.insertarChunks).not.toHaveBeenCalled();
  });

  test('el resultado de un rechazo no incluye el contenido del documento', async () => {
    const deps = armarDeps();
    const resultado = await procesarDocumento(docLimpio(`token ${CLAVE_FALSA}`), deps);
    expect(JSON.stringify(resultado)).not.toContain(CLAVE_FALSA);
  });

  test('un documento limpio pasa por chunking + embeddings + insercion', async () => {
    const deps = armarDeps();
    const resultado = await procesarDocumento(docLimpio(), deps);
    expect(resultado.aceptado).toBe(true);
    if (resultado.aceptado) {
      expect(resultado.chunksInsertados).toBe(1);
    }
    expect(deps.create).toHaveBeenCalledTimes(1);
    expect(deps.insertarChunks).toHaveBeenCalledTimes(1);
  });

  test('chunks con hash ya guardado no se re-embeben (anti re-embedding)', async () => {
    const deps = armarDeps();
    // primer paso: averiguar el hash real del chunk
    await procesarDocumento(docLimpio(), deps);
    const [chunksInsertados] = deps.insertarChunks.mock.calls[0];
    const hashExistente = (chunksInsertados as Array<{ contentHash: string }>)[0].contentHash;

    const deps2 = armarDeps([hashExistente]);
    const resultado = await procesarDocumento(docLimpio(), deps2);
    expect(deps2.create).not.toHaveBeenCalled();
    if (resultado.aceptado) {
      expect(resultado.duplicados).toBe(1);
      expect(resultado.chunksInsertados).toBe(0);
    }
  });

  test('con reemplazarFuente se reemplazan los chunks de la fuente SIN filtrar por hashes', async () => {
    const deps = armarDeps(['cualquier-hash']);
    const doc = docLimpio('contenido actualizado del archivo');
    doc.sourceId = 'x/y:src/a.ts';
    const resultado = await procesarDocumento(doc, deps, { reemplazarFuente: true });
    expect(deps.reemplazarChunksDeFuente).toHaveBeenCalledWith(
      'telegram_manual',
      'x/y:src/a.ts',
      expect.any(Array)
    );
    expect(deps.insertarChunks).not.toHaveBeenCalled();
    // no filtro por hashes existentes: el archivo cambio y sus chunks viejos se borran
    expect(deps.hashesExistentes).not.toHaveBeenCalled();
    expect(resultado.aceptado).toBe(true);
  });
});

describe('procesarDocumentos', () => {
  test('procesa una lista y devuelve un resultado por documento', async () => {
    const deps = armarDeps();
    const resultados = await procesarDocumentos(
      [docLimpio(), docLimpio(`con secreto ${CLAVE_FALSA}`)],
      deps
    );
    expect(resultados).toHaveLength(2);
    expect(resultados[0].aceptado).toBe(true);
    expect(resultados[1].aceptado).toBe(false);
  });
});
