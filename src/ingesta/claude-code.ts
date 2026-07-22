/**
 * Ingesta de Claude Code — La Guantera (Fase 2), lado servidor
 *
 * Recibe el lote que manda scripts/colector-claude.ts desde la maquina local
 * (via webhook publico de n8n → POST /ingesta/claude-code con X-Guantera-Secret):
 * las memorias de workspaces de la Memoria nativa de Motor Agentico 2.0
 * (~/.claude/projects/<slug>/memory/*.md), con contenido COMPLETO — no el
 * live-data.json del aggregator, que va anonimizado y sin cuerpo.
 *
 * Payload: { documentos: [{ sourceId, contenido, metadata? }], manifiesto?: [sourceId] }
 * - El sourceType del payload se IGNORA: aqui todo entra como claude_code, para
 *   que un lote malformado no pueda tocar chunks de otras fuentes.
 * - El manifiesto (sourceIds vigentes en la maquina local) alimenta el sweep:
 *   memorias borradas localmente se borran de guantera_chunks (decision #7).
 * - Dedup, reemplazo y chequeo de secretos: el mismo camino que Notion/n8n
 *   (sincronizarDocumentos → procesarDocumento).
 */

import type { DependenciasPipeline } from '../pipeline.js';
import { sincronizarDocumentos } from './notion-n8n.js';
import type { SalidaHttp } from '../consulta/api.js';
import type { DocumentoCrudo } from '../tipos.js';

export async function manejarLoteClaudeCode(
  cuerpo: unknown,
  deps: DependenciasPipeline
): Promise<SalidaHttp> {
  const payload = (cuerpo ?? {}) as Record<string, unknown>;

  if (!Array.isArray(payload.documentos)) {
    return { status: 400, cuerpo: { error: 'Falta "documentos" (lista de memorias).' } };
  }

  const documentos: DocumentoCrudo[] = [];
  for (const crudo of payload.documentos as unknown[]) {
    const doc = (crudo ?? {}) as Record<string, unknown>;
    if (typeof doc.sourceId !== 'string' || !doc.sourceId.trim()) {
      return { status: 400, cuerpo: { error: 'Cada documento necesita un "sourceId" (string no vacio).' } };
    }
    if (typeof doc.contenido !== 'string' || !doc.contenido.trim()) {
      return {
        status: 400,
        cuerpo: { error: `Documento ${doc.sourceId}: falta "contenido" (string no vacio).` },
      };
    }
    documentos.push({
      sourceType: 'claude_code',
      sourceId: doc.sourceId,
      contenido: doc.contenido,
      tipoContenido: 'texto',
      metadata:
        doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
          ? (doc.metadata as Record<string, unknown>)
          : {},
    });
  }

  let manifiesto: Set<string> | undefined;
  if (payload.manifiesto !== undefined) {
    if (!Array.isArray(payload.manifiesto) || payload.manifiesto.some((id) => typeof id !== 'string')) {
      return { status: 400, cuerpo: { error: '"manifiesto" debe ser una lista de sourceIds.' } };
    }
    manifiesto = new Set(payload.manifiesto as string[]);
  }

  const resumen = await sincronizarDocumentos('claude_code', documentos, deps, manifiesto);
  return { status: 200, cuerpo: { ...resumen } };
}
