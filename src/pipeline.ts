/**
 * Pipeline compartido — La Guantera
 *
 * El camino unico que recorre TODO contenido, venga de donde venga
 * (BRIEF 5): chequeo de secretos → chunking → embeddings → guantera_chunks.
 *
 * Un documento con secreto se rechaza completo y solo se registra su sourceId
 * y el NOMBRE del patron — nunca el contenido (no negociable).
 */

import type { AlmacenGuantera } from './almacenamiento/supabase-client.js';
import { chequearSecretos } from './procesamiento/chequeo-secretos.js';
import { chunkearDocumento } from './procesamiento/chunking.js';
import { embeberChunks, type ClienteEmbeddings } from './procesamiento/embeddings.js';
import type { DocumentoCrudo } from './tipos.js';

export interface DependenciasPipeline {
  almacen: AlmacenGuantera;
  clienteEmbeddings: ClienteEmbeddings;
}

export type ResultadoDocumento =
  | { aceptado: true; sourceId: string; chunksInsertados: number; duplicados: number }
  | { aceptado: false; sourceId: string; patrones: string[] };

export interface OpcionesProceso {
  /**
   * Para snapshots de archivos que cambiaron (sourceId = `repo:ruta`): borra
   * los chunks viejos de esa fuente e inserta los nuevos. En este modo NO se
   * filtra por hashes existentes — los chunks previos se van a borrar, asi que
   * "ya existe" no significa "ya esta guardado".
   */
  reemplazarFuente?: boolean;
}

export async function procesarDocumento(
  doc: DocumentoCrudo,
  deps: DependenciasPipeline,
  opciones: OpcionesProceso = {}
): Promise<ResultadoDocumento> {
  const chequeo = chequearSecretos(doc.contenido);
  if (chequeo.tieneSecretos) {
    console.warn(
      `[pipeline] rechazado por chequeo de secretos: ${doc.sourceId} (${chequeo.patronesDetectados.join(', ')})`
    );
    return { aceptado: false, sourceId: doc.sourceId, patrones: chequeo.patronesDetectados };
  }

  const chunks = chunkearDocumento(doc);

  if (opciones.reemplazarFuente) {
    const { embebidos } = await embeberChunks(chunks, { cliente: deps.clienteEmbeddings });
    const { insertados, duplicados } = await deps.almacen.reemplazarChunksDeFuente(
      doc.sourceType,
      doc.sourceId,
      embebidos
    );
    return { aceptado: true, sourceId: doc.sourceId, chunksInsertados: insertados, duplicados };
  }

  const hashesExistentes = await deps.almacen.hashesExistentes(chunks.map((c) => c.contentHash));
  const { embebidos, omitidos } = await embeberChunks(chunks, {
    cliente: deps.clienteEmbeddings,
    hashesExistentes,
  });
  const { insertados, duplicados } = await deps.almacen.insertarChunks(embebidos);
  return {
    aceptado: true,
    sourceId: doc.sourceId,
    chunksInsertados: insertados,
    duplicados: duplicados + omitidos,
  };
}

export async function procesarDocumentos(
  docs: DocumentoCrudo[],
  deps: DependenciasPipeline,
  opciones: OpcionesProceso = {}
): Promise<ResultadoDocumento[]> {
  const resultados: ResultadoDocumento[] = [];
  for (const doc of docs) {
    resultados.push(await procesarDocumento(doc, deps, opciones));
  }
  return resultados;
}
