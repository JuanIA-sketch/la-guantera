import { describe, expect, test, vi } from 'vitest';
import { manejarBusqueda } from '../../src/consulta/api.js';
import type { AlmacenGuantera } from '../../src/almacenamiento/supabase-client.js';
import type { ClienteEmbeddings } from '../../src/procesamiento/embeddings.js';
import type { ResultadoBusqueda } from '../../src/tipos.js';

const clienteEmbeddings: ClienteEmbeddings = {
  embeddings: {
    create: vi.fn(async () => ({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] })),
  },
};

function resultado(n: number): ResultadoBusqueda {
  return {
    id: `id-${n}`,
    contenido: `contenido exacto ${n}`,
    sourceType: 'notion',
    sourceId: `pag-${n}`,
    sourceUrl: `https://notion.so/pag-${n}`,
    metadata: { titulo: `Pagina ${n}` },
    similitud: 0.9 - n * 0.1,
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
    listarSourceIds: vi.fn(),
  } as unknown as AlmacenGuantera;
  return { almacen, buscar };
}

describe('manejarBusqueda (POST /buscar)', () => {
  test('sin pregunta responde 400 con un error claro', async () => {
    const { almacen, buscar } = almacenCon([resultado(1)]);
    const salida = await manejarBusqueda({}, { clienteEmbeddings, almacen });
    expect(salida.status).toBe(400);
    expect(salida.cuerpo).toMatchObject({ error: expect.stringMatching(/pregunta/i) });
    expect(buscar).not.toHaveBeenCalled();
  });

  test('una pregunta que no es string o esta vacia responde 400', async () => {
    const { almacen } = almacenCon([]);
    expect((await manejarBusqueda({ pregunta: '   ' }, { clienteEmbeddings, almacen })).status).toBe(400);
    expect((await manejarBusqueda({ pregunta: 42 }, { clienteEmbeddings, almacen })).status).toBe(400);
  });

  test('con resultados responde 200 con la lista completa: contenido exacto + fuente + similitud', async () => {
    const lista = [resultado(1), resultado(2), resultado(3), resultado(4)];
    const { almacen } = almacenCon(lista);

    const salida = await manejarBusqueda({ pregunta: 'donde quedo X?' }, { clienteEmbeddings, almacen });

    expect(salida.status).toBe(200);
    expect(salida.cuerpo).toEqual({
      encontrado: true,
      resultados: lista.map((r) => ({
        contenido: r.contenido,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        sourceUrl: r.sourceUrl,
        metadata: r.metadata,
        similitud: r.similitud,
      })),
    });
  });

  test('sin resultados responde 200 con encontrado=false y lista vacia', async () => {
    const { almacen } = almacenCon([]);
    const salida = await manejarBusqueda({ pregunta: 'algo inexistente' }, { clienteEmbeddings, almacen });
    expect(salida.status).toBe(200);
    expect(salida.cuerpo).toEqual({ encontrado: false, resultados: [] });
  });

  test('pasa limite, umbral y filtros validos a la busqueda', async () => {
    const { almacen, buscar } = almacenCon([]);
    await manejarBusqueda(
      {
        pregunta: 'pregunta',
        limite: 3,
        umbral: 0.5,
        fuentes: ['notion', 'n8n'],
        desde: '2026-01-01T00:00:00Z',
        hasta: '2026-07-01T00:00:00Z',
      },
      { clienteEmbeddings, almacen }
    );
    expect(buscar).toHaveBeenCalledWith([0.1, 0.2, 0.3], 3, 0.5, {
      fuentes: ['notion', 'n8n'],
      desde: '2026-01-01T00:00:00Z',
      hasta: '2026-07-01T00:00:00Z',
    });
  });

  test('una fuente desconocida responde 400 sin buscar', async () => {
    const { almacen, buscar } = almacenCon([]);
    const salida = await manejarBusqueda(
      { pregunta: 'pregunta', fuentes: ['facebook'] },
      { clienteEmbeddings, almacen }
    );
    expect(salida.status).toBe(400);
    expect(salida.cuerpo).toMatchObject({ error: expect.stringMatching(/fuente/i) });
    expect(buscar).not.toHaveBeenCalled();
  });

  test('una fecha no parseable responde 400 sin buscar', async () => {
    const { almacen, buscar } = almacenCon([]);
    const salida = await manejarBusqueda(
      { pregunta: 'pregunta', desde: 'ayer por la tarde' },
      { clienteEmbeddings, almacen }
    );
    expect(salida.status).toBe(400);
    expect(salida.cuerpo).toMatchObject({ error: expect.stringMatching(/fecha|desde/i) });
    expect(buscar).not.toHaveBeenCalled();
  });

  test('limite o umbral invalidos responden 400', async () => {
    const { almacen } = almacenCon([]);
    expect(
      (await manejarBusqueda({ pregunta: 'p', limite: 'muchos' }, { clienteEmbeddings, almacen })).status
    ).toBe(400);
    expect(
      (await manejarBusqueda({ pregunta: 'p', umbral: 2 }, { clienteEmbeddings, almacen })).status
    ).toBe(400);
  });
});
