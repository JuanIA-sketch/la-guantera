import { describe, expect, test, vi } from 'vitest';
import {
  archivosTocadosDePush,
  backfillRepo,
  documentoDeArchivo,
  transformarPayloadGitHub,
  type LectorGitHub,
} from '../../src/ingesta/github.js';

// Fixtures 100% sinteticos (no negociable) — ningun dato real de repos.

const REPO = 'JuanIA-sketch/la-alarma';

function lectorFalso(sobrescribir: Partial<LectorGitHub> = {}): LectorGitHub {
  return {
    listarCommitsConArchivos: vi.fn(async () => [
      {
        sha: 'aaa111',
        mensaje: 'Decidimos usar HNSW en vez de IVFFlat',
        autor: 'charly',
        fecha: '2026-07-01T10:00:00Z',
        url: `https://github.com/${REPO}/commit/aaa111`,
        archivos: ['scripts/schema.sql', 'docs/BRIEF.md'],
      },
    ]),
    obtenerArbol: vi.fn(async () => [
      { ruta: 'src/index.ts', tamano: 500 },
      { ruta: 'README.md', tamano: 300 },
    ]),
    obtenerArchivo: vi.fn(async (_repo: string, ruta: string) => {
      if (ruta === '.gitignore') return null;
      return `contenido de ${ruta}`;
    }),
    ...sobrescribir,
  };
}

describe('backfillRepo', () => {
  test('genera un documento de texto por commit con mensaje + archivos tocados', async () => {
    const docs = await backfillRepo(lectorFalso(), REPO);
    const docCommit = docs.find((d) => d.sourceId === 'aaa111');
    expect(docCommit).toBeDefined();
    expect(docCommit!.sourceType).toBe('github');
    expect(docCommit!.tipoContenido).toBe('texto');
    expect(docCommit!.contenido).toContain('Decidimos usar HNSW en vez de IVFFlat');
    expect(docCommit!.contenido).toContain('scripts/schema.sql');
    expect(docCommit!.sourceUrl).toBe(`https://github.com/${REPO}/commit/aaa111`);
    expect(docCommit!.metadata).toMatchObject({ repo: REPO, autor: 'charly' });
  });

  test('genera un documento de snapshot por archivo del arbol de HEAD', async () => {
    const docs = await backfillRepo(lectorFalso(), REPO);
    const snapshot = docs.find((d) => d.sourceId === `${REPO}:src/index.ts`);
    expect(snapshot).toBeDefined();
    expect(snapshot!.tipoContenido).toBe('codigo');
    expect(snapshot!.contenido).toBe('contenido de src/index.ts');
    expect(snapshot!.sourceUrl).toBe(`https://github.com/${REPO}/blob/HEAD/src/index.ts`);
  });

  test('los archivos .md del snapshot van como texto, no como codigo', async () => {
    const docs = await backfillRepo(lectorFalso(), REPO);
    const readme = docs.find((d) => d.sourceId === `${REPO}:README.md`);
    expect(readme!.tipoContenido).toBe('texto');
  });

  test('respeta el .gitignore del repo: no indexa rutas ignoradas', async () => {
    const obtenerArchivo = vi.fn(async (_repo: string, ruta: string) => {
      if (ruta === '.gitignore') return 'dist/\n*.log\n';
      return `contenido de ${ruta}`;
    });
    const lector = lectorFalso({
      obtenerArbol: vi.fn(async () => [
        { ruta: 'src/index.ts', tamano: 100 },
        { ruta: 'dist/bundle.js', tamano: 100 },
        { ruta: 'debug.log', tamano: 50 },
      ]),
      obtenerArchivo,
    });
    const docs = await backfillRepo(lector, REPO);
    const rutas = docs.map((d) => d.sourceId);
    expect(rutas).toContain(`${REPO}:src/index.ts`);
    expect(rutas).not.toContain(`${REPO}:dist/bundle.js`);
    expect(rutas).not.toContain(`${REPO}:debug.log`);
    // ni siquiera se descargan los ignorados
    expect(obtenerArchivo).not.toHaveBeenCalledWith(REPO, 'dist/bundle.js');
  });

  test('salta archivos gigantes sin descargarlos', async () => {
    const obtenerArchivo = vi.fn(async () => 'x');
    const lector = lectorFalso({
      obtenerArbol: vi.fn(async () => [{ ruta: 'datos/enorme.json', tamano: 5_000_000 }]),
      obtenerArchivo,
    });
    const docs = await backfillRepo(lector, REPO);
    expect(docs.filter((d) => d.sourceId.includes('enorme'))).toHaveLength(0);
    expect(obtenerArchivo).not.toHaveBeenCalledWith(REPO, 'datos/enorme.json');
  });

  test('salta binarios (extension conocida o contenido null) y lockfiles', async () => {
    const lector = lectorFalso({
      obtenerArbol: vi.fn(async () => [
        { ruta: 'logo.png', tamano: 100 },
        { ruta: 'package-lock.json', tamano: 100 },
        { ruta: 'src/util.ts', tamano: 100 },
      ]),
      obtenerArchivo: vi.fn(async (_repo: string, ruta: string) =>
        ruta === '.gitignore' ? null : ruta === 'src/util.ts' ? 'ok' : null
      ),
    });
    const docs = await backfillRepo(lector, REPO);
    const rutas = docs.map((d) => d.sourceId);
    expect(rutas).not.toContain(`${REPO}:logo.png`);
    expect(rutas).not.toContain(`${REPO}:package-lock.json`);
    expect(rutas).toContain(`${REPO}:src/util.ts`);
  });
});

describe('transformarPayloadGitHub', () => {
  const payloadPush = {
    repository: { full_name: REPO },
    commits: [
      {
        id: 'bbb222',
        message: 'Bot solo responde a chat_id autorizados',
        timestamp: '2026-07-10T08:00:00Z',
        url: `https://github.com/${REPO}/commit/bbb222`,
        author: { username: 'charly' },
        added: ['src/consulta/telegram-bot.ts'],
        modified: ['docs/BRIEF.md'],
        removed: ['src/viejo.ts'],
      },
    ],
  };

  test('un push genera un documento por commit con mensaje + archivos', () => {
    const docs = transformarPayloadGitHub(payloadPush);
    expect(docs).toHaveLength(1);
    expect(docs[0].sourceId).toBe('bbb222');
    expect(docs[0].tipoContenido).toBe('texto');
    expect(docs[0].contenido).toContain('Bot solo responde a chat_id autorizados');
    expect(docs[0].contenido).toContain('src/consulta/telegram-bot.ts');
    expect(docs[0].metadata).toMatchObject({ repo: REPO, autor: 'charly' });
  });

  test('un pull_request genera un documento con titulo y cuerpo', () => {
    const docs = transformarPayloadGitHub({
      repository: { full_name: REPO },
      pull_request: {
        number: 7,
        title: 'Agrega umbral de similitud configurable',
        body: 'Sin umbral el bot respondia cualquier cosa.',
        html_url: `https://github.com/${REPO}/pull/7`,
        user: { login: 'charly' },
      },
    });
    expect(docs).toHaveLength(1);
    expect(docs[0].sourceId).toBe(`${REPO}#7:pr`);
    expect(docs[0].contenido).toContain('Agrega umbral de similitud configurable');
    expect(docs[0].contenido).toContain('Sin umbral el bot respondia cualquier cosa.');
  });

  test('un issue genera un documento con titulo y cuerpo', () => {
    const docs = transformarPayloadGitHub({
      repository: { full_name: REPO },
      issue: {
        number: 3,
        title: 'El backfill no trae historial',
        body: 'El webhook solo dispara hacia adelante.',
        html_url: `https://github.com/${REPO}/issues/3`,
        user: { login: 'charly' },
      },
    });
    expect(docs).toHaveLength(1);
    expect(docs[0].sourceId).toBe(`${REPO}#3:issue`);
    expect(docs[0].contenido).toContain('El backfill no trae historial');
  });

  test('un payload desconocido devuelve lista vacia sin explotar', () => {
    expect(transformarPayloadGitHub({ zen: 'Keep it logically awesome.' })).toEqual([]);
  });
});

describe('archivosTocadosDePush', () => {
  test('separa archivos a actualizar (added+modified) de los borrados', () => {
    const { actualizar, borrar } = archivosTocadosDePush({
      commits: [
        { added: ['a.ts'], modified: ['b.ts'], removed: ['c.ts'] },
        { added: ['c.ts'], modified: ['a.ts'], removed: ['d.ts'] },
      ],
    });
    // c.ts fue borrado y luego re-agregado: queda en actualizar, no en borrar
    expect(new Set(actualizar)).toEqual(new Set(['a.ts', 'b.ts', 'c.ts']));
    expect(borrar).toEqual(['d.ts']);
  });
});

describe('documentoDeArchivo', () => {
  test('arma el documento de snapshot con sourceId repo:ruta y tipo por extension', () => {
    const doc = documentoDeArchivo(REPO, 'notas/decision.md', '# Decision');
    expect(doc.sourceId).toBe(`${REPO}:notas/decision.md`);
    expect(doc.tipoContenido).toBe('texto');
    expect(doc.sourceType).toBe('github');
    const docCodigo = documentoDeArchivo(REPO, 'src/a.ts', 'const a = 1;');
    expect(docCodigo.tipoContenido).toBe('codigo');
  });
});
