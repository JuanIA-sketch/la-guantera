/**
 * Bot de Telegram — La Guantera
 *
 * Interfaz principal de Fase 1 (bot dedicado, decidido en modo plan):
 *   - texto libre → pregunta al motor de consulta
 *   - /nota <texto> → nota manual
 *   - voz → se transcribe; "nota ..." se guarda, el resto se consulta
 *
 * REQUISITO FIRME, NO NEGOCIABLE (BRIEF 8): el PRIMER middleware descarta en
 * silencio cualquier update cuyo chat_id no este en la lista autorizada —
 * antes de tocar consulta, ingesta o transcripcion. Ni siquiera se responde:
 * responder confirmaria que el bot existe.
 *
 * Las dependencias (pipeline de notas, motor de consulta, transcripcion) se
 * inyectan para poder probar el bot completo sin red (grammY handleUpdate +
 * transformer de API en tests).
 */

import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { interpretarTranscripcion, notaDesdeTexto } from '../ingesta/telegram-manual.js';
import type { DocumentoCrudo } from '../tipos.js';

export const MAX_MENSAJE_TELEGRAM = 4096;

export type ResultadoNota =
  | { aceptado: true; chunks: number }
  | { aceptado: false; patrones: string[] };

export interface DependenciasBot {
  token: string;
  chatIdsAutorizados: number[];
  /** Pipeline completo: chequeo de secretos → chunking → embeddings → Supabase. */
  procesarNota(doc: DocumentoCrudo): Promise<ResultadoNota>;
  /** Motor de consulta ya configurado; devuelve el mensaje listo para enviar. */
  responderPregunta(pregunta: string): Promise<string>;
  /** Descarga el audio de Telegram y lo transcribe (gpt-4o-mini-transcribe). */
  transcribir(fileId: string): Promise<string>;
  /** Solo para tests: evita el getMe inicial de grammY. */
  botInfo?: UserFromGetMe;
}

const AYUDA = [
  'La Guantera — memoria del ecosistema.',
  '',
  'Mandame una pregunta en texto o voz y te devuelvo el contenido exacto',
  'mas relevante con su fuente citada.',
  '',
  '/nota <texto> — guardar una nota manual',
  'voz que empiece con "nota" — tambien se guarda como nota',
].join('\n');

export function crearBot(deps: DependenciasBot): Bot {
  const bot = new Bot(deps.token, deps.botInfo ? { botInfo: deps.botInfo } : undefined);
  const autorizados = new Set(deps.chatIdsAutorizados);

  // Control de acceso PRIMERO — descarte silencioso de cualquier chat no autorizado.
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined || !autorizados.has(chatId)) return;
    await next();
  });

  bot.command('start', (ctx) => ctx.reply(AYUDA));

  bot.command('nota', async (ctx) => {
    const texto = (ctx.match ?? '').toString().trim();
    if (!texto) {
      await ctx.reply('Uso: /nota <texto de la nota>');
      return;
    }
    await guardarNota(ctx, texto);
  });

  bot.on('message:voice', async (ctx) => {
    const transcripcion = await deps.transcribir(ctx.msg.voice.file_id);
    const { esNota, texto } = interpretarTranscripcion(transcripcion);
    if (esNota) {
      await guardarNota(ctx, texto, 'voz');
    } else {
      const respuesta = await deps.responderPregunta(texto);
      await ctx.reply(truncarPreservandoFuente(respuesta));
    }
  });

  bot.on('message:text', async (ctx) => {
    const respuesta = await deps.responderPregunta(ctx.msg.text);
    await ctx.reply(truncarPreservandoFuente(respuesta));
  });

  bot.catch((error) => {
    // Nunca loguear payloads completos: podrian contener el texto de una nota.
    console.error('[bot] error en handler:', error.name, error.message);
  });

  interface CtxMinimo {
    chat?: { id: number };
    msg?: { message_id: number; date: number };
    reply(texto: string): Promise<unknown>;
  }

  async function guardarNota(ctx: CtxMinimo, texto: string, origen: 'texto' | 'voz' = 'texto') {
    const doc = notaDesdeTexto(texto, {
      chatId: ctx.chat!.id,
      messageId: ctx.msg!.message_id,
      fecha: new Date((ctx.msg!.date ?? 0) * 1000).toISOString(),
    });
    if (origen === 'voz') doc.metadata.origen = 'voz';
    const resultado = await deps.procesarNota(doc);
    if (resultado.aceptado) {
      await ctx.reply(`Guardado ✅ (${resultado.chunks} chunk${resultado.chunks === 1 ? '' : 's'})`);
    } else {
      await ctx.reply(
        `⚠️ No se guardo: el chequeo detecto posibles secretos (${resultado.patrones.join(', ')}). ` +
          'Quita la credencial y volve a mandarla.'
      );
    }
  }

  return bot;
}

/**
 * Trunca al limite de Telegram conservando la seccion "Fuente:" — la cita es
 * la parte irrenunciable de la respuesta (BRIEF 8).
 */
export function truncarPreservandoFuente(mensaje: string, max: number = MAX_MENSAJE_TELEGRAM): string {
  if (mensaje.length <= max) return mensaje;
  const indiceFuente = mensaje.lastIndexOf('\nFuente: ');
  if (indiceFuente === -1) return mensaje.slice(0, max - 1) + '…';
  const cola = mensaje.slice(indiceFuente);
  const separador = '\n[…]';
  const espacioContenido = max - cola.length - separador.length;
  if (espacioContenido <= 0) return cola.trimStart().slice(0, max);
  return mensaje.slice(0, espacioContenido) + separador + cola;
}

/** "111, 222" → [111, 222]. Entradas no numericas se descartan. */
export function parsearChatIds(cadena: string): number[] {
  return cadena
    .split(',')
    .map((parte) => parte.trim())
    .filter((parte) => /^-?\d+$/.test(parte))
    .map(Number);
}
