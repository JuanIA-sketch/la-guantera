/**
 * Ingesta manual por Telegram — La Guantera
 *
 * Notas sueltas escritas o dictadas por voz al bot dedicado, transformadas al
 * formato interno de documento crudo con source_type = 'telegram_manual'.
 *
 * Convencion decidida en modo plan (ajustable tras la demo):
 *   - texto: /nota <texto> guarda nota; texto libre = pregunta (lo resuelve el bot)
 *   - voz: se transcribe con OpenAI gpt-4o-mini-transcribe; si la transcripcion
 *     empieza con "nota" es una nota, si no se trata como pregunta
 *     (ver interpretarTranscripcion).
 *
 * El control de acceso por chat_id NO vive aqui: es el primer middleware del
 * bot (../consulta/telegram-bot.ts) — a este modulo solo llegan mensajes ya
 * autorizados.
 */

import OpenAI, { toFile } from 'openai';
import type { DocumentoCrudo } from '../tipos.js';

export const MODELO_TRANSCRIPCION = 'gpt-4o-mini-transcribe';

export interface ContextoNota {
  chatId: number;
  messageId: number;
  /** ISO 8601 */
  fecha: string;
}

export interface AudioNota {
  datos: Uint8Array;
  nombre: string;
}

export interface Transcriptor {
  transcribir(audio: AudioNota): Promise<string>;
}

export function crearTranscriptorOpenAI(cliente?: OpenAI): Transcriptor {
  const openai = cliente ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return {
    async transcribir(audio) {
      const respuesta = await openai.audio.transcriptions.create({
        file: await toFile(audio.datos, audio.nombre),
        model: MODELO_TRANSCRIPCION,
      });
      return respuesta.text;
    },
  };
}

export function notaDesdeTexto(texto: string, contexto: ContextoNota): DocumentoCrudo {
  return construirNota(texto, contexto, 'texto');
}

export async function notaDesdeVoz(
  audio: AudioNota,
  transcriptor: Transcriptor,
  contexto: ContextoNota
): Promise<DocumentoCrudo> {
  const transcripcion = await transcriptor.transcribir(audio);
  return construirNota(transcripcion, contexto, 'voz');
}

/**
 * Decide si una transcripcion de voz es una nota ("nota: ..." / "nota ...")
 * o una pregunta para el motor de consulta. Devuelve el texto sin el prefijo.
 */
export function interpretarTranscripcion(transcripcion: string): { esNota: boolean; texto: string } {
  const limpio = transcripcion.trim();
  const coincidencia = limpio.match(/^nota\b[\s:,.-]*/i);
  if (coincidencia && coincidencia[0].length < limpio.length) {
    return { esNota: true, texto: limpio.slice(coincidencia[0].length).trim() };
  }
  return { esNota: false, texto: limpio };
}

function construirNota(texto: string, contexto: ContextoNota, origen: 'texto' | 'voz'): DocumentoCrudo {
  const limpio = texto.trim();
  if (!limpio) throw new Error('La nota esta vacia — no hay nada que guardar.');
  return {
    sourceType: 'telegram_manual',
    sourceId: `telegram:${contexto.chatId}:${contexto.messageId}`,
    contenido: limpio,
    tipoContenido: 'texto',
    metadata: {
      chatId: contexto.chatId,
      messageId: contexto.messageId,
      fecha: contexto.fecha,
      origen,
    },
  };
}
