/**
 * Motor de consulta — La Guantera
 *
 * Pregunta en lenguaje natural → embedding (mismo modelo que la ingesta) →
 * busqueda por similitud en guantera_chunks → respuesta con el contenido
 * EXACTO del mejor chunk + su fuente citada. Nunca un resumen (BRIEF 4 y 8).
 *
 * Compartido entre el bot de Telegram (Fase 1) y la API interna (Fase 2).
 * Defaults decididos en modo plan: top-5 recuperados, se muestra el mejor +
 * hasta 2 fuentes alternativas; umbral 0.35 (configurable via UMBRAL_SIMILITUD).
 */

import type { AlmacenGuantera } from '../almacenamiento/supabase-client.js';
import { embeberTexto, type ClienteEmbeddings } from '../procesamiento/embeddings.js';
import type { ResultadoBusqueda } from '../tipos.js';

export const LIMITE_DEFAULT = 5;
export const UMBRAL_DEFAULT = 0.35;
const MAX_ALTERNATIVAS = 2;

export interface OpcionesConsulta {
  clienteEmbeddings: ClienteEmbeddings;
  almacen: AlmacenGuantera;
  limite?: number;
  umbral?: number;
}

export interface RespuestaConsulta {
  encontrado: boolean;
  /** Texto listo para enviar por Telegram (el bot solo trunca si excede su limite). */
  mensaje: string;
  principal?: ResultadoBusqueda;
  alternativas?: ResultadoBusqueda[];
}

export async function consultar(pregunta: string, opciones: OpcionesConsulta): Promise<RespuestaConsulta> {
  const { clienteEmbeddings, almacen, limite = LIMITE_DEFAULT, umbral = UMBRAL_DEFAULT } = opciones;

  const limpia = pregunta.trim();
  if (!limpia) {
    return { encontrado: false, mensaje: 'Mandame una pregunta y busco en la memoria.' };
  }

  const embedding = await embeberTexto(limpia, clienteEmbeddings);
  const resultados = await almacen.buscarPorSimilitud(embedding, limite, umbral);

  if (resultados.length === 0) {
    return {
      encontrado: false,
      mensaje:
        'No encontre nada relevante en la memoria para esa pregunta. ' +
        'Puede que ese contenido todavia no este indexado.',
    };
  }

  const [principal, ...resto] = resultados;
  const alternativas = resto.slice(0, MAX_ALTERNATIVAS);

  const lineas = [
    principal.contenido,
    '',
    `Fuente: ${citarFuente(principal)} (similitud ${Math.round(principal.similitud * 100)}%)`,
  ];
  if (alternativas.length > 0) {
    lineas.push('', 'Otras fuentes posibles:');
    for (const alternativa of alternativas) {
      lineas.push(`- ${citarFuente(alternativa)} (${Math.round(alternativa.similitud * 100)}%)`);
    }
  }

  return { encontrado: true, mensaje: lineas.join('\n'), principal, alternativas };
}

function citarFuente(resultado: ResultadoBusqueda): string {
  if (resultado.sourceUrl) return resultado.sourceUrl;
  if (resultado.sourceType === 'telegram_manual') {
    const fecha = typeof resultado.metadata.fecha === 'string' ? resultado.metadata.fecha.slice(0, 10) : '';
    return `nota de Telegram${fecha ? ` del ${fecha}` : ''}`;
  }
  return `${resultado.sourceType}: ${resultado.sourceId}`;
}
