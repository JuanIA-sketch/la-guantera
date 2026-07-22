import { describe, expect, test, vi } from 'vitest';
import { buscarResultados, consultar } from '../../src/consulta/query-engine.js';
import type { AlmacenGuantera } from '../../src/almacenamiento/supabase-client.js';
import type { ClienteEmbeddings } from '../../src/procesamiento/embeddings.js';
import type { ResultadoBusqueda } from '../../src/tipos.js';

const clienteEmbeddings: ClienteEmbeddings = {
  embeddings: {
    create: vi.fn(async () => ({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] })),
  },
};

function resultado(n: number, extra: Partial<ResultadoBusqueda> = {}): ResultadoBusqueda {
  return {
    id: `id-${n}`,
    contenido: `contenido exacto ${n}`,
    sourceType: 'github',
    sourceId: `sha-${n}`,
    sourceUrl: `https://github.com/x/y/commit/sha-${n}`,
    metadata: { repo: 'x/y' },
    similitud: 0.9 - n * 0.1,
    ...extra,
  };
}

function almacenCon(resultados: ResultadoBusqueda[]): {
  almacen: AlmacenGuantera;
  buscar: ReturnType<typeof vi.fn>;
} {
  const buscar = vi.fn(async () => resultados);
  const almacen = {
    insertarChunks: vi.fn(),
    hashesExistentes: vi.fn(),
    reemplazarChunksDeFuente: vi.fn(),
    buscarPorSimilitud: buscar,
  } as unknown as AlmacenGuantera;
  return { almacen, buscar };
}

describe('consultar', () => {
  test('embebe la pregunta y busca con el limite y umbral configurados', async () => {
    const { almacen, buscar } = almacenCon([resultado(1)]);
    await consultar('donde quedo la decision del indice?', {
      clienteEmbeddings,
      almacen,
      limite: 5,
      umbral: 0.35,
    });
    expect(buscar).toHaveBeenCalledWith([0.1, 0.2, 0.3], 5, 0.35);
  });

  test('sin resultados responde que no encontro nada relevante', async () => {
    const { almacen } = almacenCon([]);
    const respuesta = await consultar('algo inexistente', { clienteEmbeddings, almacen });
    expect(respuesta.encontrado).toBe(false);
    expect(respuesta.mensaje).toMatch(/no encontre nada relevante/i);
  });

  test('con resultados devuelve el contenido EXACTO del mejor chunk + su fuente citada', async () => {
    const { almacen } = almacenCon([resultado(1), resultado(2), resultado(3), resultado(4)]);
    const respuesta = await consultar('pregunta', { clienteEmbeddings, almacen });
    expect(respuesta.encontrado).toBe(true);
    expect(respuesta.principal).toEqual(resultado(1));
    expect(respuesta.mensaje).toContain('contenido exacto 1');
    expect(respuesta.mensaje).toContain('https://github.com/x/y/commit/sha-1');
  });

  test('lista hasta 2 fuentes alternativas, sin repetir la principal', async () => {
    const { almacen } = almacenCon([resultado(1), resultado(2), resultado(3), resultado(4)]);
    const respuesta = await consultar('pregunta', { clienteEmbeddings, almacen });
    expect(respuesta.alternativas).toHaveLength(2);
    expect(respuesta.alternativas!.map((r) => r.id)).toEqual(['id-2', 'id-3']);
    expect(respuesta.mensaje).toContain('https://github.com/x/y/commit/sha-2');
    expect(respuesta.mensaje).not.toContain('sha-4');
  });

  test('una fuente sin URL (nota de Telegram) se cita de forma legible', async () => {
    const { almacen } = almacenCon([
      resultado(1, {
        sourceType: 'telegram_manual',
        sourceUrl: undefined,
        sourceId: 'telegram:111:42',
        metadata: { fecha: '2026-07-01T10:00:00Z' },
      }),
    ]);
    const respuesta = await consultar('pregunta', { clienteEmbeddings, almacen });
    expect(respuesta.mensaje).toMatch(/nota de telegram/i);
    expect(respuesta.mensaje).toContain('2026-07-01');
  });

  test('la similitud del resultado principal aparece en el mensaje como porcentaje', async () => {
    const { almacen } = almacenCon([resultado(1, { similitud: 0.87 })]);
    const respuesta = await consultar('pregunta', { clienteEmbeddings, almacen });
    expect(respuesta.mensaje).toContain('87%');
  });

  test('una pregunta vacia no busca y lo dice claro', async () => {
    const { almacen, buscar } = almacenCon([resultado(1)]);
    const respuesta = await consultar('   ', { clienteEmbeddings, almacen });
    expect(respuesta.encontrado).toBe(false);
    expect(buscar).not.toHaveBeenCalled();
    expect(respuesta.mensaje).toMatch(/pregunta/i);
  });

  test('con filtros de fuente y fecha los pasa al almacen', async () => {
    const { almacen, buscar } = almacenCon([resultado(1)]);
    await consultar('pregunta', {
      clienteEmbeddings,
      almacen,
      filtros: { fuentes: ['notion'], desde: '2026-01-01T00:00:00Z' },
    });
    expect(buscar).toHaveBeenCalledWith([0.1, 0.2, 0.3], 5, 0.35, {
      fuentes: ['notion'],
      desde: '2026-01-01T00:00:00Z',
    });
  });
});

describe('buscarResultados', () => {
  test('embebe la pregunta y devuelve la lista COMPLETA de resultados del almacen', async () => {
    const lista = [resultado(1), resultado(2), resultado(3), resultado(4), resultado(5)];
    const { almacen, buscar } = almacenCon(lista);

    const resultados = await buscarResultados('pregunta de un agente', {
      clienteEmbeddings,
      almacen,
      limite: 5,
      umbral: 0.35,
    });

    expect(buscar).toHaveBeenCalledWith([0.1, 0.2, 0.3], 5, 0.35);
    expect(resultados).toEqual(lista);
  });

  test('pasa los filtros al almacen cuando vienen', async () => {
    const { almacen, buscar } = almacenCon([]);
    await buscarResultados('pregunta', {
      clienteEmbeddings,
      almacen,
      filtros: { fuentes: ['claude_code'], hasta: '2026-07-01T00:00:00Z' },
    });
    expect(buscar).toHaveBeenCalledWith([0.1, 0.2, 0.3], 5, 0.35, {
      fuentes: ['claude_code'],
      hasta: '2026-07-01T00:00:00Z',
    });
  });
});
