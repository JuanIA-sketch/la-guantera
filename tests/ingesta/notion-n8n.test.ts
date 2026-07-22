import { describe, expect, test, vi } from 'vitest';
import {
  bloquesATexto,
  documentoDeNotion,
  documentoDeWorkflowN8n,
  sincronizarN8n,
  sincronizarNotion,
  type PaginaNotion,
  type WorkflowN8n,
} from '../../src/ingesta/notion-n8n.js';
import type { AlmacenGuantera } from '../../src/almacenamiento/supabase-client.js';
import type { ClienteEmbeddings } from '../../src/procesamiento/embeddings.js';

// Credencial sintetica (fixture, no real) que dispara el patron aws_access_key.
const SECRETO_SINTETICO = 'AKIA' + 'FAKEFAKEFAKEFAKE';

function pagina(extra: Partial<PaginaNotion> = {}): PaginaNotion {
  return {
    id: 'pag-1',
    titulo: 'Decisiones de precios',
    url: 'https://www.notion.so/pag-1',
    ultimaEdicion: '2026-07-01T00:00:00Z',
    texto: 'El ancla de precios se decidio en julio con margen del 40%.',
    ...extra,
  };
}

function workflow(): WorkflowN8n {
  return {
    id: 'wf-9',
    nombre: 'Ingesta GitHub hacia Guantera',
    activo: true,
    etiquetas: ['guantera'],
    actualizadoEn: '2026-07-10T00:00:00Z',
    nodos: [
      { nombre: 'GitHub Trigger', tipo: 'n8n-nodes-base.githubTrigger' },
      { nombre: 'HTTP Request', tipo: 'n8n-nodes-base.httpRequest' },
    ],
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

describe('bloquesATexto', () => {
  test('convierte los tipos de bloque comunes a texto plano legible', () => {
    const texto = bloquesATexto([
      { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Titulo' }] } },
      { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Un parrafo.' }] } },
      { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: 'una vineta' }] } },
      { type: 'to_do', to_do: { rich_text: [{ plain_text: 'tarea hecha' }], checked: true } },
      {
        type: 'code',
        code: { rich_text: [{ plain_text: 'console.log(1)' }], language: 'javascript' },
      },
      { type: 'quote', quote: { rich_text: [{ plain_text: 'una cita' }] } },
    ]);
    expect(texto).toContain('# Titulo');
    expect(texto).toContain('Un parrafo.');
    expect(texto).toContain('- una vineta');
    expect(texto).toContain('[x] tarea hecha');
    expect(texto).toContain('```javascript\nconsole.log(1)\n```');
    expect(texto).toContain('> una cita');
  });

  test('bloques anidados (children) se incluyen y los tipos desconocidos se saltan sin romper', () => {
    const texto = bloquesATexto([
      {
        type: 'toggle',
        toggle: { rich_text: [{ plain_text: 'seccion' }] },
        children: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'contenido anidado' }] } }],
      },
      { type: 'unsupported_widget', unsupported_widget: {} },
    ]);
    expect(texto).toContain('seccion');
    expect(texto).toContain('contenido anidado');
  });

  test('varios rich_text del mismo bloque se concatenan', () => {
    const texto = bloquesATexto([
      {
        type: 'paragraph',
        paragraph: { rich_text: [{ plain_text: 'mitad uno ' }, { plain_text: 'mitad dos' }] },
      },
    ]);
    expect(texto).toContain('mitad uno mitad dos');
  });
});

describe('documentoDeNotion', () => {
  test('arma el DocumentoCrudo con titulo en el contenido y fuente citable', () => {
    expect(documentoDeNotion(pagina())).toEqual({
      sourceType: 'notion',
      sourceId: 'pag-1',
      sourceUrl: 'https://www.notion.so/pag-1',
      contenido: 'Decisiones de precios\n\nEl ancla de precios se decidio en julio con margen del 40%.',
      tipoContenido: 'texto',
      metadata: { titulo: 'Decisiones de precios', ultimaEdicion: '2026-07-01T00:00:00Z' },
    });
  });
});

describe('documentoDeWorkflowN8n', () => {
  test('describe el workflow de forma legible: nombre, estado, etiquetas y nodos', () => {
    const doc = documentoDeWorkflowN8n(workflow(), 'https://n8n.ejemplo.com');
    expect(doc.sourceType).toBe('n8n');
    expect(doc.sourceId).toBe('wf-9');
    expect(doc.sourceUrl).toBe('https://n8n.ejemplo.com/workflow/wf-9');
    expect(doc.tipoContenido).toBe('texto');
    expect(doc.contenido).toContain('Ingesta GitHub hacia Guantera');
    expect(doc.contenido).toMatch(/activo/i);
    expect(doc.contenido).toContain('guantera');
    expect(doc.contenido).toContain('- GitHub Trigger (n8n-nodes-base.githubTrigger)');
    expect(doc.contenido).toContain('- HTTP Request (n8n-nodes-base.httpRequest)');
    expect(doc.metadata).toEqual({
      nombre: 'Ingesta GitHub hacia Guantera',
      activo: true,
      etiquetas: ['guantera'],
      actualizadoEn: '2026-07-10T00:00:00Z',
    });
  });
});

describe('sincronizarNotion', () => {
  test('una pagina nueva o editada se procesa reemplazando sus chunks', async () => {
    const { deps, mocks } = depsPipeline();
    const resumen = await sincronizarNotion({ listarPaginas: async () => [pagina()] }, deps);
    expect(mocks.reemplazarChunksDeFuente).toHaveBeenCalledWith('notion', 'pag-1', expect.any(Array));
    expect(resumen).toEqual({ procesados: 1, omitidos: 0, rechazados: 0, borrados: 0 });
  });

  test('una pagina sin cambios se omite SIN generar embeddings nuevos (control de costo)', async () => {
    const { deps, mocks, crearEmbedding } = depsPipeline({ todoExiste: true });
    const resumen = await sincronizarNotion({ listarPaginas: async () => [pagina()] }, deps);
    expect(crearEmbedding).not.toHaveBeenCalled();
    expect(mocks.reemplazarChunksDeFuente).not.toHaveBeenCalled();
    expect(resumen).toEqual({ procesados: 0, omitidos: 1, rechazados: 0, borrados: 0 });
  });

  test('una pagina con credencial sintetica se rechaza completa y no toca el almacen', async () => {
    const { deps, mocks } = depsPipeline();
    const conSecreto = pagina({ texto: `la clave es ${SECRETO_SINTETICO}` });
    const resumen = await sincronizarNotion({ listarPaginas: async () => [conSecreto] }, deps);
    expect(mocks.reemplazarChunksDeFuente).not.toHaveBeenCalled();
    expect(mocks.insertarChunks).not.toHaveBeenCalled();
    expect(resumen.rechazados).toBe(1);
  });

  test('las paginas guardadas que ya no existen en Notion se borran (sweep)', async () => {
    const { deps, mocks } = depsPipeline({ todoExiste: true, guardados: ['pag-1', 'pag-borrada'] });
    const resumen = await sincronizarNotion({ listarPaginas: async () => [pagina()] }, deps);
    expect(mocks.listarSourceIds).toHaveBeenCalledWith('notion');
    expect(mocks.reemplazarChunksDeFuente).toHaveBeenCalledWith('notion', 'pag-borrada', []);
    expect(mocks.reemplazarChunksDeFuente).toHaveBeenCalledTimes(1);
    expect(resumen).toEqual({ procesados: 0, omitidos: 1, rechazados: 0, borrados: 1 });
  });
});

describe('sincronizarN8n', () => {
  test('procesa workflows nuevos y barre los borrados', async () => {
    const { deps, mocks } = depsPipeline({ guardados: ['wf-viejo'] });
    const resumen = await sincronizarN8n(
      { listarWorkflows: async () => [workflow()] },
      'https://n8n.ejemplo.com',
      deps
    );
    expect(mocks.reemplazarChunksDeFuente).toHaveBeenCalledWith('n8n', 'wf-9', expect.any(Array));
    expect(mocks.reemplazarChunksDeFuente).toHaveBeenCalledWith('n8n', 'wf-viejo', []);
    expect(resumen).toEqual({ procesados: 1, omitidos: 0, rechazados: 0, borrados: 1 });
  });
});
