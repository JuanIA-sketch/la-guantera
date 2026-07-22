/**
 * Colector local de memorias de Claude Code — La Guantera (Fase 2)
 *
 * Corre en la MAQUINA LOCAL de Charly (no en el VPS), programado con el Task
 * Scheduler de Windows (mismo patron que la tarea de Dream de Motor Agentico).
 * Recorre las memorias de la Memoria nativa de Motor Agentico 2.0:
 *   ~/.claude/projects/<slug-workspace>/memory/**\/*.md
 * (contenido COMPLETO, con frontmatter name/description/type) y manda el lote a
 * un webhook publico de n8n, que lo reenvia al endpoint interno del VPS
 * (POST /ingesta/claude-code) — la maquina local no alcanza 172.17.0.1.
 *
 * El manifiesto del lote lista TODO lo vigente: las memorias borradas
 * localmente se barren de guantera_chunks en el servidor (decision #7).
 *
 * Env local (en el .env de este repo clonado en la maquina local):
 *   GUANTERA_WEBHOOK_URL    — URL del webhook de n8n (https://<n8n>/webhook/guantera-claude)
 *   GUANTERA_WEBHOOK_SECRET — mismo secreto compartido del header X-Guantera-Secret
 *
 * Correr a mano: npx tsx scripts/colector-claude.ts
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface DocumentoColector {
  sourceId: string;
  contenido: string;
  metadata: Record<string, unknown>;
}

export interface LoteColector {
  documentos: DocumentoColector[];
  manifiesto: string[];
}

/** Mismo formato de frontmatter que usa la Memoria nativa (name/description/type). */
export function parsearFrontmatter(crudo: string): {
  fm: Record<string, string>;
  cuerpo: string;
} {
  // \r?\n: un .md editado con Notepad trae CRLF y sin esto el regex no separa.
  const m = crudo.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, cuerpo: crudo };
  const fm: Record<string, string> = {};
  for (const linea of m[1].split(/\r?\n/)) {
    const kv = linea.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$/);
    if (!kv) continue;
    let valor = kv[2].trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    fm[kv[1].toLowerCase()] = valor;
  }
  return { fm, cuerpo: m[2] };
}

/**
 * Un archivo de memoria → documento del lote, o null si no tiene nada que
 * indexar. name y description del frontmatter van DENTRO del contenido:
 * ayudan a la busqueda semantica con preguntas abstractas (hallazgo Fase 1).
 */
export function documentoDeMemoria(
  slugWorkspace: string,
  rutaRelativa: string,
  crudo: string,
  modificadoIso: string
): DocumentoColector | null {
  const { fm, cuerpo } = parsearFrontmatter(crudo);
  const partes = [fm.name, fm.description, cuerpo.trim()].filter(
    (parte): parte is string => !!parte && !!parte.trim()
  );
  if (partes.length === 0) return null;
  return {
    sourceId: `${slugWorkspace}:${rutaRelativa}`,
    contenido: partes.join('\n\n'),
    metadata: {
      workspace: slugWorkspace,
      ruta: rutaRelativa,
      ...(fm.name ? { name: fm.name } : {}),
      ...(fm.description ? { description: fm.description } : {}),
      ...(fm.type ? { type: fm.type } : {}),
      modificado: modificadoIso,
    },
  };
}

export function construirLote(documentos: DocumentoColector[]): LoteColector {
  return { documentos, manifiesto: documentos.map((doc) => doc.sourceId) };
}

async function archivosMd(dir: string): Promise<string[]> {
  const salida: string[] = [];
  let entradas;
  try {
    entradas = await readdir(dir, { withFileTypes: true });
  } catch {
    return salida;
  }
  for (const entrada of entradas) {
    if (entrada.name.startsWith('.')) continue;
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...(await archivosMd(ruta)));
    else if (entrada.isFile() && entrada.name.toLowerCase().endsWith('.md')) salida.push(ruta);
  }
  return salida;
}

/** Recorre ~/.claude/projects/<slug>/memory/**\/*.md y arma los documentos. */
export async function recolectarMemorias(
  raizProyectos = join(homedir(), '.claude', 'projects')
): Promise<DocumentoColector[]> {
  const documentos: DocumentoColector[] = [];
  let slugs: string[] = [];
  try {
    slugs = await readdir(raizProyectos);
  } catch {
    return documentos;
  }
  for (const slug of slugs) {
    const dirMemoria = join(raizProyectos, slug, 'memory');
    for (const archivo of await archivosMd(dirMemoria)) {
      let crudo: string;
      let mtime: Date;
      try {
        crudo = await readFile(archivo, 'utf8');
        mtime = (await stat(archivo)).mtime;
      } catch {
        continue;
      }
      const rutaRelativa = relative(dirMemoria, archivo).replace(/\\/g, '/');
      const doc = documentoDeMemoria(slug, rutaRelativa, crudo, mtime.toISOString());
      if (doc) documentos.push(doc);
    }
  }
  return documentos;
}

async function main(): Promise<void> {
  const { config } = await import('dotenv');
  config();

  const url = process.env.GUANTERA_WEBHOOK_URL?.trim();
  const secreto = process.env.GUANTERA_WEBHOOK_SECRET?.trim();
  if (!url || !secreto) {
    console.error(
      'Faltan variables de entorno del colector (revisa tu .env):\n' +
        '  - GUANTERA_WEBHOOK_URL: URL del webhook de n8n que reenvia a POST /ingesta/claude-code\n' +
        '  - GUANTERA_WEBHOOK_SECRET: secreto compartido del header X-Guantera-Secret'
    );
    process.exit(1);
  }

  const documentos = await recolectarMemorias();
  const lote = construirLote(documentos);
  console.log(`[colector] ${lote.documentos.length} memorias encontradas; mandando lote...`);

  const respuesta = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-guantera-secret': secreto },
    body: JSON.stringify(lote),
  });
  if (!respuesta.ok) {
    console.error(`[colector] fallo el envio: ${respuesta.status} ${await respuesta.text()}`);
    process.exit(1);
  }
  console.log(`[colector] resumen del servidor: ${await respuesta.text()}`);
}

const esEjecucionDirecta =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (esEjecucionDirecta) {
  main().catch((error) => {
    console.error('[colector] error fatal:', (error as Error).message);
    process.exit(1);
  });
}
