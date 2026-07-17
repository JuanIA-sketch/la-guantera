import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  chunkearDocumento,
  MAX_CHARS_CHUNK,
} from '../../src/procesamiento/chunking.js';
import type { DocumentoCrudo } from '../../src/tipos.js';

function docTexto(contenido: string): DocumentoCrudo {
  return {
    sourceType: 'telegram_manual',
    sourceId: 'nota-42',
    sourceUrl: undefined,
    contenido,
    tipoContenido: 'texto',
    metadata: { autor: 'charly' },
  };
}

function docCodigo(contenido: string): DocumentoCrudo {
  return {
    sourceType: 'github',
    sourceId: 'JuanIA-sketch/la-alarma:src/index.ts',
    sourceUrl: 'https://github.com/JuanIA-sketch/la-alarma/blob/main/src/index.ts',
    contenido,
    tipoContenido: 'codigo',
    metadata: { repo: 'JuanIA-sketch/la-alarma' },
  };
}

describe('chunkearDocumento', () => {
  test('documento mas corto que el limite queda en un solo chunk identico', () => {
    const doc = docTexto('Una nota corta sobre la decision del indice HNSW.');
    const chunks = chunkearDocumento(doc);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].contenido).toBe(doc.contenido);
    expect(chunks[0].chunkIndex).toBe(0);
  });

  test('propaga sourceType, sourceId, sourceUrl y metadata a cada chunk', () => {
    const doc = docCodigo('const x = 1;\n'.repeat(500));
    const chunks = chunkearDocumento(doc);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.sourceType).toBe('github');
      expect(chunk.sourceId).toBe(doc.sourceId);
      expect(chunk.sourceUrl).toBe(doc.sourceUrl);
      expect(chunk.metadata).toEqual(doc.metadata);
    }
  });

  test('chunkIndex es secuencial desde 0', () => {
    const doc = docCodigo('let y = 2;\n'.repeat(500));
    const chunks = chunkearDocumento(doc);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  test('contentHash es el sha256 hex del contenido del chunk', () => {
    const doc = docTexto('contenido estable para hashear');
    const [chunk] = chunkearDocumento(doc);
    const esperado = createHash('sha256').update(chunk.contenido).digest('hex');
    expect(chunk.contentHash).toBe(esperado);
  });

  test('el mismo contenido produce siempre el mismo hash (determinismo del anti re-embedding)', () => {
    const [a] = chunkearDocumento(docTexto('identico'));
    const [b] = chunkearDocumento(docTexto('identico'));
    expect(a.contentHash).toBe(b.contentHash);
  });

  test('texto largo se parte por parrafos sin exceder el limite de tamano', () => {
    const parrafos = 'ABCDEFGHIJ'.split('').map((letra) => letra.repeat(280));
    const doc = docTexto(parrafos.join('\n\n'));
    const chunks = chunkearDocumento(doc);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.contenido.length).toBeLessThanOrEqual(MAX_CHARS_CHUNK);
    }
  });

  test('chunks de texto consecutivos se solapan: el siguiente arranca con el ultimo parrafo del anterior', () => {
    const parrafos = 'ABCDEFGHIJ'.split('').map((letra) => letra.repeat(280));
    const chunks = chunkearDocumento(docTexto(parrafos.join('\n\n')));
    for (let i = 1; i < chunks.length; i++) {
      const parrafosPrevios = chunks[i - 1].contenido.split('\n\n');
      const ultimoParrafoPrevio = parrafosPrevios[parrafosPrevios.length - 1];
      expect(chunks[i].contenido.startsWith(ultimoParrafoPrevio)).toBe(true);
    }
  });

  test('codigo largo se parte por lineas, con lineas de solape entre chunks consecutivos', () => {
    const lineas = Array.from({ length: 400 }, (_, i) => `const variable_${String(i).padStart(3, '0')} = ${i};`);
    const chunks = chunkearDocumento(docCodigo(lineas.join('\n')));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.contenido.length).toBeLessThanOrEqual(MAX_CHARS_CHUNK);
    }
    for (let i = 1; i < chunks.length; i++) {
      const primeraLineaSiguiente = chunks[i].contenido.split('\n')[0];
      expect(chunks[i - 1].contenido).toContain(primeraLineaSiguiente);
    }
  });

  test('un parrafo gigante (sin quiebres) se corta duro sin exceder el limite', () => {
    const doc = docTexto('x'.repeat(MAX_CHARS_CHUNK * 3));
    const chunks = chunkearDocumento(doc);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.contenido.length).toBeLessThanOrEqual(MAX_CHARS_CHUNK);
    }
  });

  test('documento vacio o solo espacios no produce chunks', () => {
    expect(chunkearDocumento(docTexto('   \n\n  '))).toEqual([]);
  });
});
