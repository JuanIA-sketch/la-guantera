import { describe, expect, test, vi } from 'vitest';
import { manejarLoteClaudeCode } from '../../src/ingesta/claude-code.js';
import type { AlmacenGuantera } from '../../src/almacenamiento/supabase-client.js';
import type { ClienteEmbeddings } from '../../src/procesamiento/embeddings.js';

// Credencial sintetica (fixture, no real) que dispara el patron aws_access_key.
const SECRETO_SINTETICO = 'AKIA' + 'FAKEFAKEFAKEFAKE';

function documento(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceId: 'ws-guantera:decision-embeddings.md',
    contenido:
      'Proveedor de embeddings\n\nSe eligio OpenAI text-embedding-3-small por costo/calidad.',
    metadata: { workspace: 'ws-guantera', type: 'project' },
    ...extra,
  };
}

function depsPipeline(opciones: { todoExiste?: boolean; guardados?: string[] } = {}) {
  const mocks = {
    insertarChunks: vi.fn(async (chunks: unknown[]) => ({
      insertados: chunks.length,
      duplicados: 0,
    })),
    hashesExistentes: vi.fn(async (hashes: string[]) =>
      opciones.todoExiste ? new Set(hashes) : new Set<string>()
    ),
    reemplazarChunksDeFuente: vi.fn(async (_t: string, _id: string, chunks: unknown[]) => ({
      insertados: chunks.length,
      duplicados: 0,
    })),
    buscarPorSimilitud: vi.fn(),
    listarSourceIds: vi.fn(async () => new Set(opciones.guardados ?? [])),
  };
  const crearEmbedding = vi.fn(async ({ input }: { input: string | string[] }) => {
    const textos = Array.isArray(input) ? input : [input];
    return { data: textos.map((_, index) => ({ index, embedding: [0.1, 0.2] })) };
  });
  const clienteEmbeddings = { embeddings: { create: crearEmbedding } } as ClienteEmbeddings;
  return {
    deps: { almacen: mocks as unknown as AlmacenGuantera, clienteEmbeddings },
    mocks,
    crearEmbedding,
  };
}

describe('manejarLoteClaudeCode (POST /ingesta/claude-code)', () => {
  test('un payload sin lista de documentos responde 400', async () => {
    const { deps } = depsPipeline();
    const salida = await manejarLoteClaudeCode({}, deps);
    expect(salida.status).toBe(400);
    expect(salida.cuerpo).toMatchObject({ error: expect.stringMatching(/documentos/i) });
  });

  test('un documento sin sourceId o sin contenido responde 400 sin procesar nada', async () => {
    const { deps, mocks } = depsPipeline();
    const sinId = await manejarLoteClaudeCode({ documentos: [documento({ sourceId: '' })] }, deps);
    expect(sinId.status).toBe(400);
    const sinContenido = await manejarLoteClaudeCode(
      { documentos: [documento({ contenido: 42 })] },
      deps
    );
    expect(sinContenido.status).toBe(400);
    expect(mocks.reemplazarChunksDeFuente).not.toHaveBeenCalled();
  });

  test('un lote valido se procesa como claude_code y devuelve el resumen', async () => {
    const { deps, mocks } = depsPipeline();
    const salida = await manejarLoteClaudeCode({ documentos: [documento()] }, deps);
    expect(salida.status).toBe(200);
    expect(mocks.reemplazarChunksDeFuente).toHaveBeenCalledWith(
      'claude_code',
      'ws-guantera:decision-embeddings.md',
      expect.any(Array)
    );
    expect(salida.cuerpo).toEqual({ procesados: 1, omitidos: 0, rechazados: 0, borrados: 0 });
  });

  test('el sourceType del payload se ignora: todo entra como claude_code', async () => {
    const { deps, mocks } = depsPipeline();
    await manejarLoteClaudeCode({ documentos: [documento({ sourceType: 'github' })] }, deps);
    const tiposUsados = mocks.reemplazarChunksDeFuente.mock.calls.map((llamada) => llamada[0]);
    expect(tiposUsados).toEqual(['claude_code']);
  });

  test('una memoria sin cambios se omite sin generar embeddings', async () => {
    const { deps, crearEmbedding } = depsPipeline({ todoExiste: true });
    const salida = await manejarLoteClaudeCode({ documentos: [documento()] }, deps);
    expect(crearEmbedding).not.toHaveBeenCalled();
    expect(salida.cuerpo).toEqual({ procesados: 0, omitidos: 1, rechazados: 0, borrados: 0 });
  });

  test('una memoria con credencial sintetica se rechaza completa', async () => {
    const { deps, mocks } = depsPipeline();
    const salida = await manejarLoteClaudeCode(
      { documentos: [documento({ contenido: `la clave era ${SECRETO_SINTETICO}` })] },
      deps
    );
    expect(mocks.reemplazarChunksDeFuente).not.toHaveBeenCalled();
    expect(salida.cuerpo).toMatchObject({ rechazados: 1 });
  });

  test('el manifiesto manda para el sweep: lo guardado que no este ahi se borra', async () => {
    const { deps, mocks } = depsPipeline({
      todoExiste: true,
      guardados: ['ws-guantera:decision-embeddings.md', 'ws-viejo:memoria-borrada.md'],
    });
    const salida = await manejarLoteClaudeCode(
      {
        documentos: [documento()],
        manifiesto: ['ws-guantera:decision-embeddings.md'],
      },
      deps
    );
    expect(mocks.reemplazarChunksDeFuente).toHaveBeenCalledWith(
      'claude_code',
      'ws-viejo:memoria-borrada.md',
      []
    );
    expect(salida.cuerpo).toEqual({ procesados: 0, omitidos: 1, rechazados: 0, borrados: 1 });
  });
});
