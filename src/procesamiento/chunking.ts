/**
 * Chunking — La Guantera
 *
 * Parte un "documento crudo" (de cualquier fuente) en fragmentos del tamano
 * adecuado para generar embeddings utiles (BRIEF 7.2):
 *   - Codigo (GitHub): por lineas, con solape pequeño entre chunks
 *   - Texto libre (notas, Notion, conversaciones): por parrafo, con solape mayor
 *
 * El chequeo de secretos (./chequeo-secretos.ts) corre ANTES de esta etapa —
 * aqui solo llega contenido ya verificado.
 */

import { createHash } from 'node:crypto';
import type { Chunk, DocumentoCrudo } from '../tipos.js';

// Heuristica de tokenizacion: ~4 caracteres por token (sin dependencia de tokenizer).
// 600 tokens ≈ 2400 chars por chunk. Solape: ~75 tokens (300 chars) en texto,
// ~40 tokens (160 chars) en codigo.
export const MAX_CHARS_CHUNK = 2400;
const SOLAPE_CHARS_TEXTO = 300;
const SOLAPE_CHARS_CODIGO = 160;

export function chunkearDocumento(doc: DocumentoCrudo): Chunk[] {
  const trozos =
    doc.tipoContenido === 'codigo'
      ? partirCodigo(doc.contenido)
      : partirTexto(doc.contenido);

  return trozos.map((contenido, chunkIndex) => ({
    sourceType: doc.sourceType,
    sourceId: doc.sourceId,
    sourceUrl: doc.sourceUrl,
    contenido,
    contentHash: createHash('sha256').update(contenido).digest('hex'),
    chunkIndex,
    metadata: doc.metadata,
  }));
}

function partirTexto(texto: string): string[] {
  const limpio = texto.trim();
  if (!limpio) return [];
  if (limpio.length <= MAX_CHARS_CHUNK) return [limpio];

  const parrafos = limpio
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const trozos: string[] = [];
  let actual: string[] = [];
  // false mientras `actual` solo contenga el parrafo arrastrado como solape:
  // un chunk que sea puro solape no aporta nada y no se emite.
  let hayContenidoNuevo = false;
  const largoActual = () => actual.reduce((suma, p) => suma + p.length + 2, 0);

  for (const parrafo of parrafos) {
    if (parrafo.length > MAX_CHARS_CHUNK) {
      if (hayContenidoNuevo) trozos.push(actual.join('\n\n'));
      actual = [];
      hayContenidoNuevo = false;
      trozos.push(...corteDuro(parrafo, SOLAPE_CHARS_TEXTO));
      continue;
    }
    if (actual.length > 0 && largoActual() + parrafo.length + 2 > MAX_CHARS_CHUNK) {
      if (hayContenidoNuevo) trozos.push(actual.join('\n\n'));
      const ultimo = actual[actual.length - 1];
      const cabeSolape =
        hayContenidoNuevo &&
        ultimo.length <= SOLAPE_CHARS_TEXTO &&
        ultimo.length + 2 + parrafo.length <= MAX_CHARS_CHUNK;
      actual = cabeSolape ? [ultimo] : [];
      hayContenidoNuevo = false;
    }
    actual.push(parrafo);
    hayContenidoNuevo = true;
  }
  if (hayContenidoNuevo) trozos.push(actual.join('\n\n'));
  return trozos;
}

function partirCodigo(codigo: string): string[] {
  if (!codigo.trim()) return [];
  if (codigo.length <= MAX_CHARS_CHUNK) return [codigo];

  const lineas = codigo.split('\n');
  const trozos: string[] = [];
  let actual: string[] = [];
  let hayContenidoNuevo = false;
  const largoActual = () => actual.reduce((suma, l) => suma + l.length + 1, 0);

  for (const linea of lineas) {
    if (linea.length > MAX_CHARS_CHUNK) {
      if (hayContenidoNuevo) trozos.push(actual.join('\n'));
      actual = [];
      hayContenidoNuevo = false;
      trozos.push(...corteDuro(linea, SOLAPE_CHARS_CODIGO));
      continue;
    }
    if (actual.length > 0 && largoActual() + linea.length + 1 > MAX_CHARS_CHUNK) {
      if (hayContenidoNuevo) trozos.push(actual.join('\n'));
      actual = hayContenidoNuevo
        ? colaParaSolape(actual, SOLAPE_CHARS_CODIGO, linea.length)
        : [];
      hayContenidoNuevo = false;
    }
    actual.push(linea);
    hayContenidoNuevo = true;
  }
  if (hayContenidoNuevo) trozos.push(actual.join('\n'));
  return trozos;
}

/** Ultimas lineas del chunk anterior que caben como solape sin exceder el limite. */
function colaParaSolape(lineas: string[], maxSolape: number, largoSiguiente: number): string[] {
  const cola: string[] = [];
  let total = 0;
  for (let i = lineas.length - 1; i >= 0; i--) {
    const largo = lineas[i].length + 1;
    if (total + largo > maxSolape) break;
    if (total + largo + largoSiguiente + 1 > MAX_CHARS_CHUNK) break;
    cola.unshift(lineas[i]);
    total += largo;
  }
  return cola;
}

/** Corte por posicion fija para contenido sin quiebres naturales (parrafo/linea gigante). */
function corteDuro(texto: string, solape: number): string[] {
  const paso = MAX_CHARS_CHUNK - solape;
  const trozos: string[] = [];
  for (let i = 0; i < texto.length; i += paso) {
    trozos.push(texto.slice(i, i + MAX_CHARS_CHUNK));
    if (i + MAX_CHARS_CHUNK >= texto.length) break;
  }
  return trozos;
}
