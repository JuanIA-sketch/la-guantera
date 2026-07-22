import { describe, expect, test } from 'vitest';
import {
  construirLote,
  documentoDeMemoria,
  parsearFrontmatter,
} from '../../scripts/colector-claude.js';

const MEMORIA = `---
name: decision-embeddings
description: Proveedor de embeddings elegido para La Guantera
metadata:
  type: project
---

Se eligio OpenAI text-embedding-3-small por costo/calidad ($0.02/millon de tokens).
`;

describe('parsearFrontmatter', () => {
  test('separa frontmatter y cuerpo', () => {
    const { fm, cuerpo } = parsearFrontmatter(MEMORIA);
    expect(fm.name).toBe('decision-embeddings');
    expect(fm.description).toBe('Proveedor de embeddings elegido para La Guantera');
    expect(cuerpo).toContain('Se eligio OpenAI text-embedding-3-small');
    expect(cuerpo).not.toContain('---');
  });

  test('sin frontmatter devuelve el contenido tal cual', () => {
    const { fm, cuerpo } = parsearFrontmatter('solo un parrafo suelto');
    expect(fm).toEqual({});
    expect(cuerpo).toBe('solo un parrafo suelto');
  });

  test('aguanta CRLF de Windows (Notepad)', () => {
    const conCrlf = MEMORIA.replace(/\n/g, '\r\n');
    const { fm, cuerpo } = parsearFrontmatter(conCrlf);
    expect(fm.name).toBe('decision-embeddings');
    expect(cuerpo).toContain('text-embedding-3-small');
  });
});

describe('documentoDeMemoria', () => {
  test('arma el documento con name + description + cuerpo y metadata completa', () => {
    const doc = documentoDeMemoria(
      'c--Users-operator-proyectos-la-guantera',
      'decision-embeddings.md',
      MEMORIA,
      '2026-07-15T10:00:00.000Z'
    );
    expect(doc).not.toBeNull();
    expect(doc!.sourceId).toBe('c--Users-operator-proyectos-la-guantera:decision-embeddings.md');
    expect(doc!.contenido).toContain('decision-embeddings');
    expect(doc!.contenido).toContain('Proveedor de embeddings elegido para La Guantera');
    expect(doc!.contenido).toContain('Se eligio OpenAI text-embedding-3-small');
    expect(doc!.metadata).toMatchObject({
      workspace: 'c--Users-operator-proyectos-la-guantera',
      ruta: 'decision-embeddings.md',
      name: 'decision-embeddings',
      modificado: '2026-07-15T10:00:00.000Z',
    });
  });

  test('un archivo vacio o solo espacios devuelve null (no se manda)', () => {
    expect(documentoDeMemoria('ws', 'vacia.md', '   \n  ', '2026-07-15T10:00:00.000Z')).toBeNull();
    expect(documentoDeMemoria('ws', 'solo-fm.md', '---\nname: x\n---\n\n', '2026-07-15T10:00:00.000Z')
      // con frontmatter pero sin cuerpo: el name/description siguen siendo contenido util
    ).not.toBeNull();
  });
});

describe('construirLote', () => {
  test('el manifiesto lista los sourceIds de TODOS los documentos del lote', () => {
    const a = documentoDeMemoria('ws-1', 'a.md', 'contenido a', '2026-07-15T10:00:00.000Z')!;
    const b = documentoDeMemoria('ws-2', 'b.md', 'contenido b', '2026-07-15T10:00:00.000Z')!;
    const lote = construirLote([a, b]);
    expect(lote.documentos).toEqual([a, b]);
    expect(lote.manifiesto).toEqual(['ws-1:a.md', 'ws-2:b.md']);
  });
});
