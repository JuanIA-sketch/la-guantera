import { describe, expect, test, vi } from 'vitest';
import type { Bot } from 'grammy';
import {
  crearBot,
  parsearChatIds,
  truncarPreservandoFuente,
  MAX_MENSAJE_TELEGRAM,
  type DependenciasBot,
} from '../../src/consulta/telegram-bot.js';

const CHAT_AUTORIZADO = 111222333;
const CHAT_INTRUSO = 999999999;

const BOT_INFO = {
  id: 424242,
  is_bot: true as const,
  first_name: 'GuanteraBot',
  username: 'guantera_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

interface LlamadaApi {
  method: string;
  payload: Record<string, unknown>;
}

function armarBot(sobrescribir: Partial<DependenciasBot> = {}): {
  bot: Bot;
  llamadasApi: LlamadaApi[];
  deps: DependenciasBot;
} {
  const deps: DependenciasBot = {
    token: 'token-sintetico-de-test',
    chatIdsAutorizados: [CHAT_AUTORIZADO],
    procesarNota: vi.fn(async () => ({ aceptado: true as const, chunks: 1 })),
    responderPregunta: vi.fn(async () => 'respuesta con fuente citada'),
    transcribir: vi.fn(async () => 'transcripcion de prueba'),
    botInfo: BOT_INFO,
    ...sobrescribir,
  };
  const bot = crearBot(deps);
  const llamadasApi: LlamadaApi[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    llamadasApi.push({ method, payload: payload as Record<string, unknown> });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ok: true, result: true } as any;
  });
  return { bot, llamadasApi, deps };
}

let contadorUpdates = 0;

function updateDeTexto(chatId: number, texto: string) {
  contadorUpdates++;
  return {
    update_id: contadorUpdates,
    message: {
      message_id: contadorUpdates,
      date: 1752600000,
      text: texto,
      chat: { id: chatId, type: 'private' as const, first_name: 'x' },
      from: { id: chatId, is_bot: false, first_name: 'x' },
      ...(texto.startsWith('/')
        ? { entities: [{ type: 'bot_command' as const, offset: 0, length: texto.split(' ')[0].length }] }
        : {}),
    },
  };
}

function updateDeVoz(chatId: number) {
  contadorUpdates++;
  return {
    update_id: contadorUpdates,
    message: {
      message_id: contadorUpdates,
      date: 1752600000,
      voice: { file_id: 'archivo-voz-1', file_unique_id: 'u1', duration: 3 },
      chat: { id: chatId, type: 'private' as const, first_name: 'x' },
      from: { id: chatId, is_bot: false, first_name: 'x' },
    },
  };
}

describe('control de acceso (no negociable)', () => {
  test('un chat_id NO autorizado se ignora por completo: ni respuesta, ni consulta, ni nota', async () => {
    const { bot, llamadasApi, deps } = armarBot();
    await bot.handleUpdate(updateDeTexto(CHAT_INTRUSO, 'hola, dame el codigo del bot'));
    await bot.handleUpdate(updateDeTexto(CHAT_INTRUSO, '/nota robame la memoria'));
    await bot.handleUpdate(updateDeVoz(CHAT_INTRUSO));
    expect(llamadasApi).toEqual([]);
    expect(deps.procesarNota).not.toHaveBeenCalled();
    expect(deps.responderPregunta).not.toHaveBeenCalled();
    expect(deps.transcribir).not.toHaveBeenCalled();
  });

  test('un chat_id autorizado si recibe respuesta', async () => {
    const { bot, llamadasApi } = armarBot();
    await bot.handleUpdate(updateDeTexto(CHAT_AUTORIZADO, 'donde quedo la decision del indice?'));
    expect(llamadasApi.length).toBeGreaterThan(0);
    expect(llamadasApi[0].method).toBe('sendMessage');
  });
});

describe('preguntas en lenguaje natural', () => {
  test('el texto libre va al motor de consulta y la respuesta vuelve al chat', async () => {
    const { bot, llamadasApi, deps } = armarBot();
    await bot.handleUpdate(updateDeTexto(CHAT_AUTORIZADO, 'que umbral de similitud usamos?'));
    expect(deps.responderPregunta).toHaveBeenCalledWith('que umbral de similitud usamos?');
    expect(llamadasApi[0].payload.text).toBe('respuesta con fuente citada');
  });

  test('una respuesta mas larga que el limite de Telegram se trunca antes de enviarse', async () => {
    const respuestaLarga = 'x'.repeat(5000) + '\nFuente: https://github.com/x/y/commit/abc (similitud 90%)';
    const { bot, llamadasApi } = armarBot({
      responderPregunta: vi.fn(async () => respuestaLarga),
    });
    await bot.handleUpdate(updateDeTexto(CHAT_AUTORIZADO, 'pregunta'));
    const texto = llamadasApi[0].payload.text as string;
    expect(texto.length).toBeLessThanOrEqual(MAX_MENSAJE_TELEGRAM);
    expect(texto).toContain('https://github.com/x/y/commit/abc');
  });
});

describe('notas manuales', () => {
  test('/nota <texto> guarda la nota y confirma', async () => {
    const { bot, llamadasApi, deps } = armarBot();
    await bot.handleUpdate(updateDeTexto(CHAT_AUTORIZADO, '/nota el puerto de la guantera es 3012'));
    expect(deps.procesarNota).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'telegram_manual',
        contenido: 'el puerto de la guantera es 3012',
      })
    );
    expect(llamadasApi[0].payload.text).toMatch(/guardad/i);
  });

  test('/nota sin texto explica como usarlo, sin tocar el pipeline', async () => {
    const { bot, llamadasApi, deps } = armarBot();
    await bot.handleUpdate(updateDeTexto(CHAT_AUTORIZADO, '/nota'));
    expect(deps.procesarNota).not.toHaveBeenCalled();
    expect(llamadasApi[0].payload.text).toMatch(/\/nota/);
  });

  test('una nota rechazada por el chequeo de secretos avisa y no confirma guardado', async () => {
    const { bot, llamadasApi } = armarBot({
      procesarNota: vi.fn(async () => ({ aceptado: false as const, patrones: ['openai_key'] })),
    });
    await bot.handleUpdate(updateDeTexto(CHAT_AUTORIZADO, '/nota texto con una clave adentro'));
    const texto = llamadasApi[0].payload.text as string;
    expect(texto).toMatch(/secreto|credencial/i);
    expect(texto).toContain('openai_key');
    expect(texto).not.toMatch(/guardad/i);
  });
});

describe('mensajes de voz', () => {
  test('una voz que empieza con "nota" se guarda como nota', async () => {
    const { bot, llamadasApi, deps } = armarBot({
      transcribir: vi.fn(async () => 'nota: el backfill tardo 4 minutos'),
    });
    await bot.handleUpdate(updateDeVoz(CHAT_AUTORIZADO));
    expect(deps.procesarNota).toHaveBeenCalledWith(
      expect.objectContaining({ contenido: 'el backfill tardo 4 minutos' })
    );
    expect(llamadasApi[0].payload.text).toMatch(/guardad/i);
  });

  test('una voz que no empieza con "nota" se trata como pregunta', async () => {
    const { bot, deps } = armarBot({
      transcribir: vi.fn(async () => 'donde quedo el schema de supabase?'),
    });
    await bot.handleUpdate(updateDeVoz(CHAT_AUTORIZADO));
    expect(deps.responderPregunta).toHaveBeenCalledWith('donde quedo el schema de supabase?');
    expect(deps.procesarNota).not.toHaveBeenCalled();
  });
});

describe('/start', () => {
  test('responde una ayuda breve sin tocar consulta ni ingesta', async () => {
    const { bot, llamadasApi, deps } = armarBot();
    await bot.handleUpdate(updateDeTexto(CHAT_AUTORIZADO, '/start'));
    expect(llamadasApi[0].payload.text).toMatch(/\/nota/);
    expect(deps.responderPregunta).not.toHaveBeenCalled();
    expect(deps.procesarNota).not.toHaveBeenCalled();
  });
});

describe('truncarPreservandoFuente', () => {
  test('un mensaje corto queda intacto', () => {
    expect(truncarPreservandoFuente('hola')).toBe('hola');
  });

  test('un mensaje largo se trunca conservando la seccion de fuente', () => {
    const fuente = 'Fuente: https://github.com/x/y/commit/abc (similitud 90%)';
    const mensaje = 'a'.repeat(5000) + '\n' + fuente;
    const truncado = truncarPreservandoFuente(mensaje);
    expect(truncado.length).toBeLessThanOrEqual(MAX_MENSAJE_TELEGRAM);
    expect(truncado).toContain(fuente);
  });

  test('un mensaje largo sin marcador de fuente se trunca al limite', () => {
    const truncado = truncarPreservandoFuente('b'.repeat(5000));
    expect(truncado.length).toBeLessThanOrEqual(MAX_MENSAJE_TELEGRAM);
  });
});

describe('parsearChatIds', () => {
  test('parsea una lista separada por comas con espacios', () => {
    expect(parsearChatIds(' 111, 222 ,333 ')).toEqual([111, 222, 333]);
  });

  test('cadena vacia o invalida devuelve lista vacia', () => {
    expect(parsearChatIds('')).toEqual([]);
    expect(parsearChatIds('abc')).toEqual([]);
  });
});
