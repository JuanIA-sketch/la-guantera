/**
 * Ingesta de GitHub — La Guantera
 *
 * Dos responsabilidades (BRIEF 6.1):
 *
 * 1. Backfill inicial (`backfillRepo`): recorre el historial YA EXISTENTE de un
 *    repo — el GitHub Trigger de n8n solo dispara hacia adelante. Estrategia
 *    hibrida decidida en modo plan:
 *      - un documento de texto por commit (mensaje + archivos tocados)
 *      - un documento por archivo del snapshot actual de HEAD (los fragmentos
 *        de codigo reales), respetando el .gitignore del repo y saltando
 *        binarios, lockfiles y archivos gigantes
 *
 * 2. Ingesta hacia adelante (`transformarPayloadGitHub`): convierte el payload
 *    que n8n reenvia (push / pull_request / issues) a documentos crudos.
 *    `archivosTocadosDePush` dice que snapshots re-descargar o borrar.
 *
 * El chequeo de secretos corre DESPUES, en el pipeline compartido
 * (src/pipeline.ts) — aqui solo se transforma al formato interno.
 */

import { Octokit } from '@octokit/rest';
import ignore from 'ignore';
import type { DocumentoCrudo } from '../tipos.js';

/** Tamano maximo de archivo a indexar en el snapshot (~25k tokens). */
export const MAX_TAMANO_ARCHIVO = 100 * 1024;

const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb']);
const EXTENSIONES_BINARIAS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg', 'pdf', 'zip', 'tar', 'gz',
  'exe', 'dll', 'so', 'woff', 'woff2', 'ttf', 'eot', 'mp3', 'mp4', 'mov', 'sqlite', 'db',
]);
const EXTENSIONES_TEXTO = new Set(['md', 'txt', 'rst', 'adoc']);

export interface CommitConArchivos {
  sha: string;
  mensaje: string;
  autor: string;
  fecha: string;
  url: string;
  archivos: string[];
}

export interface ArchivoArbol {
  ruta: string;
  tamano: number;
}

/** Subconjunto de la API de GitHub que usa el backfill — inyectable en tests. */
export interface LectorGitHub {
  listarCommitsConArchivos(repo: string): Promise<CommitConArchivos[]>;
  /** Arbol recursivo de HEAD (solo blobs). */
  obtenerArbol(repo: string): Promise<ArchivoArbol[]>;
  /** Contenido decodificado de un archivo, o null si es binario / no se pudo leer. */
  obtenerArchivo(repo: string, ruta: string): Promise<string | null>;
}

/** Adapter real sobre Octokit. Requiere GITHUB_TOKEN con permiso de lectura. */
export function crearLectorGitHub(token: string): LectorGitHub {
  const octokit = new Octokit({ auth: token });

  const partirRepo = (repo: string): { owner: string; repo: string } => {
    const [owner, nombre] = repo.split('/');
    return { owner, repo: nombre };
  };

  return {
    async listarCommitsConArchivos(repoCompleto) {
      const params = partirRepo(repoCompleto);
      const commits = await octokit.paginate(octokit.rest.repos.listCommits, {
        ...params,
        per_page: 100,
      });
      const resultado: CommitConArchivos[] = [];
      for (const commit of commits) {
        const detalle = await octokit.rest.repos.getCommit({ ...params, ref: commit.sha });
        resultado.push({
          sha: commit.sha,
          mensaje: commit.commit.message,
          autor: commit.commit.author?.name ?? commit.author?.login ?? 'desconocido',
          fecha: commit.commit.author?.date ?? '',
          url: commit.html_url,
          archivos: (detalle.data.files ?? []).map((f) => f.filename),
        });
      }
      return resultado;
    },

    async obtenerArbol(repoCompleto) {
      const params = partirRepo(repoCompleto);
      const { data } = await octokit.rest.git.getTree({
        ...params,
        tree_sha: 'HEAD',
        recursive: 'true',
      });
      return data.tree
        .filter((entrada) => entrada.type === 'blob' && entrada.path)
        .map((entrada) => ({ ruta: entrada.path as string, tamano: entrada.size ?? 0 }));
    },

    async obtenerArchivo(repoCompleto, ruta) {
      const params = partirRepo(repoCompleto);
      try {
        const { data } = await octokit.rest.repos.getContent({ ...params, path: ruta });
        if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) return null;
        const texto = Buffer.from(data.content, 'base64').toString('utf8');
        // heuristica minima de binario: bytes nulos
        return texto.includes('\0') ? null : texto;
      } catch {
        return null;
      }
    },
  };
}

/** Backfill completo de un repo: documentos de commits + snapshot de archivos de HEAD. */
export async function backfillRepo(lector: LectorGitHub, repo: string): Promise<DocumentoCrudo[]> {
  const documentos: DocumentoCrudo[] = [];

  for (const commit of await lector.listarCommitsConArchivos(repo)) {
    documentos.push(documentoDeCommit(repo, commit));
  }

  const filtroIgnore = ignore();
  const gitignore = await lector.obtenerArchivo(repo, '.gitignore');
  if (gitignore) filtroIgnore.add(gitignore);

  for (const entrada of await lector.obtenerArbol(repo)) {
    if (!esIndexable(entrada, filtroIgnore)) continue;
    const contenido = await lector.obtenerArchivo(repo, entrada.ruta);
    if (contenido === null || !contenido.trim()) continue;
    documentos.push(documentoDeArchivo(repo, entrada.ruta, contenido));
  }

  return documentos;
}

function esIndexable(entrada: ArchivoArbol, filtroIgnore: ReturnType<typeof ignore>): boolean {
  const nombre = entrada.ruta.split('/').pop() ?? entrada.ruta;
  if (entrada.tamano > MAX_TAMANO_ARCHIVO) return false;
  if (LOCKFILES.has(nombre)) return false;
  const extension = nombre.includes('.') ? nombre.split('.').pop()!.toLowerCase() : '';
  if (EXTENSIONES_BINARIAS.has(extension)) return false;
  if (filtroIgnore.ignores(entrada.ruta)) return false;
  return true;
}

function documentoDeCommit(repo: string, commit: CommitConArchivos): DocumentoCrudo {
  const lineasArchivos = commit.archivos.map((a) => `- ${a}`).join('\n');
  return {
    sourceType: 'github',
    sourceId: commit.sha,
    sourceUrl: commit.url,
    contenido: `${commit.mensaje}\n\nArchivos tocados:\n${lineasArchivos}`,
    tipoContenido: 'texto',
    metadata: { repo, autor: commit.autor, fecha: commit.fecha, archivos: commit.archivos },
  };
}

/** Documento de snapshot de un archivo (usado por backfill y por la ingesta hacia adelante). */
export function documentoDeArchivo(repo: string, ruta: string, contenido: string): DocumentoCrudo {
  const extension = ruta.includes('.') ? ruta.split('.').pop()!.toLowerCase() : '';
  return {
    sourceType: 'github',
    sourceId: `${repo}:${ruta}`,
    sourceUrl: `https://github.com/${repo}/blob/HEAD/${ruta}`,
    contenido,
    tipoContenido: EXTENSIONES_TEXTO.has(extension) ? 'texto' : 'codigo',
    metadata: { repo, ruta },
  };
}

/**
 * Convierte el payload que n8n reenvia desde su GitHub Trigger a documentos
 * crudos. El tipo de evento se infiere de la forma del payload — no dependemos
 * de configuracion extra en n8n.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformarPayloadGitHub(payload: any): DocumentoCrudo[] {
  const repo: string | undefined = payload?.repository?.full_name;

  if (Array.isArray(payload?.commits) && repo) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return payload.commits.map((commit: any) =>
      documentoDeCommit(repo, {
        sha: commit.id,
        mensaje: commit.message ?? '',
        autor: commit.author?.username ?? commit.author?.name ?? 'desconocido',
        fecha: commit.timestamp ?? '',
        url: commit.url ?? '',
        archivos: [
          ...(commit.added ?? []),
          ...(commit.modified ?? []),
          ...(commit.removed ?? []).map((r: string) => `${r} (borrado)`),
        ],
      })
    );
  }

  if (payload?.pull_request && repo) {
    const pr = payload.pull_request;
    return [
      {
        sourceType: 'github',
        sourceId: `${repo}#${pr.number}:pr`,
        sourceUrl: pr.html_url,
        contenido: `PR #${pr.number}: ${pr.title}\n\n${pr.body ?? ''}`.trim(),
        tipoContenido: 'texto',
        metadata: { repo, autor: pr.user?.login, numero: pr.number, tipo: 'pull_request' },
      },
    ];
  }

  if (payload?.issue && repo) {
    const issue = payload.issue;
    return [
      {
        sourceType: 'github',
        sourceId: `${repo}#${issue.number}:issue`,
        sourceUrl: issue.html_url,
        contenido: `Issue #${issue.number}: ${issue.title}\n\n${issue.body ?? ''}`.trim(),
        tipoContenido: 'texto',
        metadata: { repo, autor: issue.user?.login, numero: issue.number, tipo: 'issue' },
      },
    ];
  }

  return [];
}

/**
 * Rutas tocadas por un push, para mantener el snapshot al dia:
 * - actualizar: added+modified (re-descargar y reemplazar chunks)
 * - borrar: removed que no reaparecen despues (eliminar sus chunks)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function archivosTocadosDePush(payload: any): { actualizar: string[]; borrar: string[] } {
  const actualizar = new Set<string>();
  const borrar = new Set<string>();
  for (const commit of payload?.commits ?? []) {
    for (const ruta of [...(commit.added ?? []), ...(commit.modified ?? [])]) {
      actualizar.add(ruta);
      borrar.delete(ruta);
    }
    for (const ruta of commit.removed ?? []) {
      borrar.add(ruta);
      actualizar.delete(ruta);
    }
  }
  return { actualizar: [...actualizar], borrar: [...borrar] };
}
