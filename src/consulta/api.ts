/**
 * API interna — La Guantera (Fase 2)
 *
 * Expone ./query-engine.ts por HTTP para que otros agentes del stack de Charly
 * (el orquestador de charly-marketing, charly-prospecting, etc.) puedan consultar
 * La Guantera directamente, como una base de conocimiento compartida del negocio.
 *
 * Mismo patron de red que los demas agentes del VPS: expuesta solo internamente
 * (172.17.0.1), nunca publica. Auth: header X-Guantera-Api-Secret (GUANTERA_API_SECRET),
 * distinto del secreto de ingesta n8n<->Guantera. El transporte HTTP vive en
 * src/index.ts; aqui solo la validacion del body y el formato de respuesta:
 * contenido EXACTO + fuente citada + similitud, nunca un resumen (BRIEF 4 y 8).
 */

import type { AlmacenGuantera } from '../almacenamiento/supabase-client.js';
import type { ClienteEmbeddings } from '../procesamiento/embeddings.js';
import { buscarResultados } from './query-engine.js';
import { SOURCE_TYPES, type FiltrosBusqueda, type SourceType } from '../tipos.js';

export interface DependenciasApi {
  clienteEmbeddings: ClienteEmbeddings;
  almacen: AlmacenGuantera;
}

export interface SalidaHttp {
  status: number;
  cuerpo: Record<string, unknown>;
}

export async function manejarBusqueda(cuerpo: unknown, deps: DependenciasApi): Promise<SalidaHttp> {
  const peticion = (cuerpo ?? {}) as Record<string, unknown>;

  const pregunta = peticion.pregunta;
  if (typeof pregunta !== 'string' || !pregunta.trim()) {
    return { status: 400, cuerpo: { error: 'Falta "pregunta" (string no vacio).' } };
  }

  const limite = peticion.limite ?? undefined;
  if (limite !== undefined && (!Number.isInteger(limite) || (limite as number) <= 0)) {
    return { status: 400, cuerpo: { error: '"limite" debe ser un entero positivo.' } };
  }

  const umbral = peticion.umbral ?? undefined;
  if (umbral !== undefined && (typeof umbral !== 'number' || umbral <= 0 || umbral >= 1)) {
    return { status: 400, cuerpo: { error: '"umbral" debe ser un numero entre 0 y 1.' } };
  }

  const filtros: FiltrosBusqueda = {};
  if (peticion.fuentes !== undefined) {
    const fuentes = peticion.fuentes;
    const validas =
      Array.isArray(fuentes) && fuentes.every((f) => SOURCE_TYPES.includes(f as SourceType));
    if (!validas || (fuentes as unknown[]).length === 0) {
      return {
        status: 400,
        cuerpo: { error: `"fuentes" debe ser una lista de: ${SOURCE_TYPES.join(', ')}.` },
      };
    }
    filtros.fuentes = fuentes as SourceType[];
  }
  for (const campo of ['desde', 'hasta'] as const) {
    const valor = peticion[campo];
    if (valor === undefined) continue;
    if (typeof valor !== 'string' || Number.isNaN(Date.parse(valor))) {
      return { status: 400, cuerpo: { error: `"${campo}" debe ser una fecha ISO 8601.` } };
    }
    filtros[campo] = valor;
  }

  const resultados = await buscarResultados(pregunta.trim(), {
    clienteEmbeddings: deps.clienteEmbeddings,
    almacen: deps.almacen,
    ...(limite !== undefined ? { limite: limite as number } : {}),
    ...(umbral !== undefined ? { umbral: umbral as number } : {}),
    ...(Object.keys(filtros).length > 0 ? { filtros } : {}),
  });

  return {
    status: 200,
    cuerpo: {
      encontrado: resultados.length > 0,
      resultados: resultados.map((r) => ({
        contenido: r.contenido,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        sourceUrl: r.sourceUrl,
        metadata: r.metadata,
        similitud: r.similitud,
      })),
    },
  };
}
