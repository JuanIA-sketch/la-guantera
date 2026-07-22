/**
 * Ingesta de n8n / Notion — La Guantera (Fase 2)
 *
 * Sync periodico SIN push nativo: n8n solo hace de reloj (Schedule Trigger →
 * POST /sync/notion y /sync/n8n); el polling y la transformacion viven aqui,
 * en TypeScript testeable (decision de modo plan, 2026-07-21).
 *
 * - Notion: POST /v1/search con el token de integracion — el alcance se
 *   controla compartiendo paginas con la integracion desde Notion, sin config
 *   extra — y luego los bloques de cada pagina convertidos a texto plano.
 * - n8n: GET /api/v1/workflows — se indexa la DEFINICION de cada workflow
 *   (nombre, estado, etiquetas, nodos), no sus ejecuciones (ruido/volumen).
 *
 * Cada corrida es un listado completo de la fuente, asi que el primer sync
 * trae lo YA existente por diseno (no solo cambios hacia adelante). Dedup
 * entre corridas por content_hash: lo no cambiado se omite sin re-embeber;
 * lo editado se procesa con reemplazarFuente; lo que ya no existe en la
 * fuente se barre al final (decision #7 del brief).
 */

import { procesarDocumento, type DependenciasPipeline } from '../pipeline.js';
import { chunkearDocumento } from '../procesamiento/chunking.js';
import type { DocumentoCrudo, SourceType } from '../tipos.js';

// ---------------------------------------------------------------- Notion

export interface PaginaNotion {
  id: string;
  titulo: string;
  url: string;
  /** last_edited_time de la API de Notion. */
  ultimaEdicion: string;
  /** Bloques de la pagina ya convertidos a texto plano. */
  texto: string;
}

/** Subconjunto de la API de Notion que usa el sync — inyectable en tests. */
export interface LectorNotion {
  listarPaginas(): Promise<PaginaNotion[]>;
}

/** Bloques de la API de Notion → texto plano legible. Tipos desconocidos se saltan. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function bloquesATexto(bloques: any[]): string {
  const lineas: string[] = [];
  for (const bloque of bloques) {
    const cuerpo = bloque?.[bloque?.type];
    const texto = (cuerpo?.rich_text ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((rt: any) => rt?.plain_text ?? '')
      .join('');
    switch (bloque?.type) {
      case 'heading_1':
        lineas.push(`# ${texto}`);
        break;
      case 'heading_2':
        lineas.push(`## ${texto}`);
        break;
      case 'heading_3':
        lineas.push(`### ${texto}`);
        break;
      case 'paragraph':
      case 'toggle':
      case 'callout':
        if (texto.trim()) lineas.push(texto);
        break;
      case 'bulleted_list_item':
      case 'numbered_list_item':
        lineas.push(`- ${texto}`);
        break;
      case 'to_do':
        lineas.push(`[${cuerpo?.checked ? 'x' : ' '}] ${texto}`);
        break;
      case 'code':
        lineas.push(`\`\`\`${cuerpo?.language ?? ''}\n${texto}\n\`\`\``);
        break;
      case 'quote':
        lineas.push(`> ${texto}`);
        break;
      default:
        break;
    }
    if (Array.isArray(bloque?.children) && bloque.children.length > 0) {
      const anidado = bloquesATexto(bloque.children);
      if (anidado.trim()) lineas.push(anidado);
    }
  }
  return lineas.join('\n');
}

export function documentoDeNotion(pagina: PaginaNotion): DocumentoCrudo {
  return {
    sourceType: 'notion',
    sourceId: pagina.id,
    sourceUrl: pagina.url,
    // El titulo va dentro del contenido: ayuda a que la busqueda semantica
    // conecte preguntas abstractas con la pagina (hallazgo de Fase 1).
    contenido: `${pagina.titulo}\n\n${pagina.texto}`.trim(),
    tipoContenido: 'texto',
    metadata: { titulo: pagina.titulo, ultimaEdicion: pagina.ultimaEdicion },
  };
}

const NOTION_VERSION = '2022-06-28';

/** Adapter real sobre la API de Notion. Requiere NOTION_TOKEN (integracion interna). */
export function crearLectorNotion(token: string): LectorNotion {
  const cabeceras = {
    authorization: `Bearer ${token}`,
    'notion-version': NOTION_VERSION,
    'content-type': 'application/json',
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function pedir(ruta: string, init?: RequestInit): Promise<any> {
    const respuesta = await fetch(`https://api.notion.com/v1${ruta}`, {
      ...init,
      headers: cabeceras,
    });
    if (!respuesta.ok) {
      throw new Error(`Notion API ${ruta}: ${respuesta.status} ${await respuesta.text()}`);
    }
    return respuesta.json();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function bloquesDePagina(id: string): Promise<any[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bloques: any[] = [];
    let cursor: string | undefined;
    do {
      const pagina = await pedir(
        `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`
      );
      for (const bloque of pagina.results ?? []) {
        if (bloque.has_children) bloque.children = await bloquesDePagina(bloque.id);
        bloques.push(bloque);
      }
      cursor = pagina.has_more ? pagina.next_cursor : undefined;
    } while (cursor);
    return bloques;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function tituloDe(paginaCruda: any): string {
    const propiedades = paginaCruda?.properties ?? {};
    for (const propiedad of Object.values(propiedades) as any[]) {
      if (propiedad?.type === 'title') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (propiedad.title ?? []).map((rt: any) => rt?.plain_text ?? '').join('') || '(sin titulo)';
      }
    }
    return '(sin titulo)';
  }

  return {
    async listarPaginas() {
      const paginas: PaginaNotion[] = [];
      let cursor: string | undefined;
      do {
        const lote = await pedir('/search', {
          method: 'POST',
          body: JSON.stringify({
            filter: { property: 'object', value: 'page' },
            page_size: 100,
            ...(cursor ? { start_cursor: cursor } : {}),
          }),
        });
        for (const cruda of lote.results ?? []) {
          if (cruda.archived) continue;
          paginas.push({
            id: cruda.id,
            titulo: tituloDe(cruda),
            url: cruda.url ?? `https://www.notion.so/${String(cruda.id).replace(/-/g, '')}`,
            ultimaEdicion: cruda.last_edited_time ?? '',
            texto: bloquesATexto(await bloquesDePagina(cruda.id)),
          });
        }
        cursor = lote.has_more ? lote.next_cursor : undefined;
      } while (cursor);
      return paginas;
    },
  };
}

// ---------------------------------------------------------------- n8n

export interface WorkflowN8n {
  id: string;
  nombre: string;
  activo: boolean;
  etiquetas: string[];
  actualizadoEn: string;
  nodos: { nombre: string; tipo: string }[];
}

/** Subconjunto de la API de n8n que usa el sync — inyectable en tests. */
export interface LectorN8n {
  listarWorkflows(): Promise<WorkflowN8n[]>;
}

export function documentoDeWorkflowN8n(workflow: WorkflowN8n, baseUrl: string): DocumentoCrudo {
  const lineas = [
    `Workflow de n8n: ${workflow.nombre} (${workflow.activo ? 'activo' : 'inactivo'})`,
    ...(workflow.etiquetas.length > 0 ? [`Etiquetas: ${workflow.etiquetas.join(', ')}`] : []),
    'Nodos:',
    ...workflow.nodos.map((nodo) => `- ${nodo.nombre} (${nodo.tipo})`),
  ];
  return {
    sourceType: 'n8n',
    sourceId: workflow.id,
    sourceUrl: `${baseUrl.replace(/\/$/, '')}/workflow/${workflow.id}`,
    contenido: lineas.join('\n'),
    tipoContenido: 'texto',
    metadata: {
      nombre: workflow.nombre,
      activo: workflow.activo,
      etiquetas: workflow.etiquetas,
      actualizadoEn: workflow.actualizadoEn,
    },
  };
}

/** Adapter real sobre la API publica de n8n. baseUrl = raiz de la instancia (sin /api/v1). */
export function crearLectorN8n(baseUrl: string, apiKey: string): LectorN8n {
  const raiz = baseUrl.replace(/\/$/, '');
  return {
    async listarWorkflows() {
      const workflows: WorkflowN8n[] = [];
      let cursor: string | undefined;
      do {
        const url = `${raiz}/api/v1/workflows?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
        const respuesta = await fetch(url, { headers: { 'X-N8N-API-KEY': apiKey } });
        if (!respuesta.ok) {
          throw new Error(`n8n API /workflows: ${respuesta.status} ${await respuesta.text()}`);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lote: any = await respuesta.json();
        for (const cruda of lote.data ?? []) {
          workflows.push({
            id: String(cruda.id),
            nombre: cruda.name ?? '(sin nombre)',
            activo: cruda.active === true,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            etiquetas: (cruda.tags ?? []).map((t: any) => t?.name ?? String(t)),
            actualizadoEn: cruda.updatedAt ?? '',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            nodos: (cruda.nodes ?? []).map((n: any) => ({
              nombre: n?.name ?? '(sin nombre)',
              tipo: n?.type ?? 'desconocido',
            })),
          });
        }
        cursor = lote.nextCursor ?? undefined;
      } while (cursor);
      return workflows;
    },
  };
}

// ---------------------------------------------------------------- sync

export interface ResumenSync {
  procesados: number;
  omitidos: number;
  rechazados: number;
  borrados: number;
}

/**
 * Sincroniza el listado COMPLETO de una fuente contra guantera_chunks:
 * - sin cambios (todos los hashes ya guardados) → omitido, cero embeddings
 * - nuevo o editado → procesarDocumento con reemplazarFuente
 * - guardado pero ausente del listado (o del manifiesto) → borrado (sweep)
 */
export async function sincronizarDocumentos(
  sourceType: SourceType,
  documentos: DocumentoCrudo[],
  deps: DependenciasPipeline,
  manifiesto?: Set<string>
): Promise<ResumenSync> {
  const resumen: ResumenSync = { procesados: 0, omitidos: 0, rechazados: 0, borrados: 0 };
  const vigentes = manifiesto ?? new Set(documentos.map((doc) => doc.sourceId));

  for (const doc of documentos) {
    const hashes = chunkearDocumento(doc).map((chunk) => chunk.contentHash);
    if (hashes.length > 0) {
      const existentes = await deps.almacen.hashesExistentes(hashes);
      if (hashes.every((hash) => existentes.has(hash))) {
        resumen.omitidos++;
        continue;
      }
    } else {
      resumen.omitidos++;
      continue;
    }
    const resultado = await procesarDocumento(doc, deps, { reemplazarFuente: true });
    if (resultado.aceptado) resumen.procesados++;
    else resumen.rechazados++;
  }

  for (const guardado of await deps.almacen.listarSourceIds(sourceType)) {
    if (vigentes.has(guardado)) continue;
    await deps.almacen.reemplazarChunksDeFuente(sourceType, guardado, []);
    resumen.borrados++;
  }

  return resumen;
}

export async function sincronizarNotion(
  lector: LectorNotion,
  deps: DependenciasPipeline
): Promise<ResumenSync> {
  const documentos = (await lector.listarPaginas()).map(documentoDeNotion);
  return sincronizarDocumentos('notion', documentos, deps);
}

export async function sincronizarN8n(
  lector: LectorN8n,
  baseUrl: string,
  deps: DependenciasPipeline
): Promise<ResumenSync> {
  const documentos = (await lector.listarWorkflows()).map((wf) => documentoDeWorkflowN8n(wf, baseUrl));
  return sincronizarDocumentos('n8n', documentos, deps);
}
