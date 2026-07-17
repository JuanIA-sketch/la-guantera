/**
 * Embeddings — La Guantera
 *
 * Genera el vector de cada chunk antes de guardarlo en Supabase, y el de cada
 * pregunta del bot antes de buscar (mismo modelo en ambos lados, o la similitud
 * no tiene sentido).
 *
 * Proveedor decidido en modo plan: OpenAI text-embedding-3-small (1536 dims,
 * ~$0.02/millon de tokens). La dimension esta fijada en scripts/schema.sql.
 *
 * Anti re-embedding (BRIEF 7.3): los chunks cuyo content_hash ya existe en
 * guantera_chunks se filtran ANTES de llamar a la API — es lo que evita pagar
 * dos veces por contenido que no cambio.
 */

import OpenAI from 'openai';
import type { Chunk, ChunkConEmbedding } from '../tipos.js';

export const MODELO_EMBEDDINGS = 'text-embedding-3-small';
export const DIMENSION_EMBEDDINGS = 1536;

/** Subconjunto del cliente de OpenAI que usa este modulo — inyectable en tests. */
export interface ClienteEmbeddings {
  embeddings: {
    create(params: {
      model: string;
      input: string | string[];
    }): Promise<{ data: Array<{ index: number; embedding: number[] }> }>;
  };
}

export function crearClienteOpenAI(): ClienteEmbeddings {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export interface OpcionesEmbeber {
  cliente: ClienteEmbeddings;
  /** content_hash ya presentes en guantera_chunks — se omiten sin llamar a la API. */
  hashesExistentes?: Set<string>;
  maxPorLote?: number;
  reintentos?: number;
  esperaBaseMs?: number;
}

export async function embeberChunks(
  chunks: Chunk[],
  opciones: OpcionesEmbeber
): Promise<{ embebidos: ChunkConEmbedding[]; omitidos: number }> {
  const {
    cliente,
    hashesExistentes = new Set<string>(),
    maxPorLote = 100,
    reintentos = 3,
    esperaBaseMs = 1000,
  } = opciones;

  const pendientes = chunks.filter((c) => !hashesExistentes.has(c.contentHash));
  const omitidos = chunks.length - pendientes.length;

  const embebidos: ChunkConEmbedding[] = [];
  for (let i = 0; i < pendientes.length; i += maxPorLote) {
    const lote = pendientes.slice(i, i + maxPorLote);
    const respuesta = await conReintentos(
      () => cliente.embeddings.create({ model: MODELO_EMBEDDINGS, input: lote.map((c) => c.contenido) }),
      reintentos,
      esperaBaseMs
    );
    for (const item of respuesta.data) {
      embebidos.push({ ...lote[item.index], embedding: item.embedding });
    }
  }
  return { embebidos, omitidos };
}

/** Embedding de un texto suelto (la pregunta del bot). */
export async function embeberTexto(texto: string, cliente: ClienteEmbeddings): Promise<number[]> {
  const respuesta = await conReintentos(
    () => cliente.embeddings.create({ model: MODELO_EMBEDDINGS, input: texto }),
    3,
    1000
  );
  return respuesta.data[0].embedding;
}

/** Backoff exponencial solo para errores transitorios (429, 5xx, red). */
async function conReintentos<T>(fn: () => Promise<T>, reintentos: number, esperaBaseMs: number): Promise<T> {
  let ultimoError: unknown;
  for (let intento = 0; intento <= reintentos; intento++) {
    try {
      return await fn();
    } catch (error) {
      ultimoError = error;
      if (!esReintentable(error) || intento === reintentos) throw error;
      await esperar(esperaBaseMs * 2 ** intento);
    }
  }
  throw ultimoError;
}

function esReintentable(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  if (status === undefined) return true; // error de red, sin respuesta HTTP
  return status === 429 || status >= 500;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
