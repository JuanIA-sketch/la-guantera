import { describe, expect, test, vi } from 'vitest';
import {
  interpretarTranscripcion,
  notaDesdeTexto,
  notaDesdeVoz,
  type Transcriptor,
} from '../../src/ingesta/telegram-manual.js';

const CONTEXTO = { chatId: 111222333, messageId: 42, fecha: '2026-07-16T12:00:00Z' };

describe('notaDesdeTexto', () => {
  test('arma un documento crudo telegram_manual con el texto exacto', () => {
    const doc = notaDesdeTexto('El VPS usa el rango de puertos 3000-3011', CONTEXTO);
    expect(doc.sourceType).toBe('telegram_manual');
    expect(doc.sourceId).toBe('telegram:111222333:42');
    expect(doc.contenido).toBe('El VPS usa el rango de puertos 3000-3011');
    expect(doc.tipoContenido).toBe('texto');
    expect(doc.metadata).toMatchObject({
      chatId: 111222333,
      messageId: 42,
      fecha: '2026-07-16T12:00:00Z',
      origen: 'texto',
    });
  });

  test('rechaza una nota vacia', () => {
    expect(() => notaDesdeTexto('   ', CONTEXTO)).toThrow(/vacia/i);
  });
});

describe('notaDesdeVoz', () => {
  test('transcribe el audio y guarda la transcripcion como contenido, con origen voz', async () => {
    const transcriptor: Transcriptor = {
      transcribir: vi.fn(async () => 'recordar renovar el dominio en agosto'),
    };
    const doc = await notaDesdeVoz(
      { datos: new Uint8Array([1, 2, 3]), nombre: 'voz.ogg' },
      transcriptor,
      CONTEXTO
    );
    expect(doc.contenido).toBe('recordar renovar el dominio en agosto');
    expect(doc.metadata).toMatchObject({ origen: 'voz' });
    expect(doc.sourceId).toBe('telegram:111222333:42');
  });
});

describe('interpretarTranscripcion', () => {
  test('una transcripcion que empieza con "nota" es una nota, sin el prefijo', () => {
    expect(interpretarTranscripcion('Nota: comprar el dominio guantera.dev')).toEqual({
      esNota: true,
      texto: 'comprar el dominio guantera.dev',
    });
    expect(interpretarTranscripcion('nota comprar el dominio')).toEqual({
      esNota: true,
      texto: 'comprar el dominio',
    });
  });

  test('cualquier otra transcripcion se trata como pregunta', () => {
    expect(interpretarTranscripcion('donde quedo la decision del indice HNSW?')).toEqual({
      esNota: false,
      texto: 'donde quedo la decision del indice HNSW?',
    });
  });

  test('una palabra que solo empieza con "nota" (ej. "notable") no es una nota', () => {
    const resultado = interpretarTranscripcion('notable mejora del bot');
    expect(resultado.esNota).toBe(false);
  });
});
