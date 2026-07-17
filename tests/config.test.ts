import { describe, expect, test } from 'vitest';
import { validarEnv, VARIABLES_FASE_1 } from '../src/config.js';

function envCompleto(): Record<string, string> {
  return Object.fromEntries(VARIABLES_FASE_1.map((v) => [v.nombre, 'valor-sintetico']));
}

describe('validarEnv', () => {
  test('con todas las variables presentes no falta nada', () => {
    expect(validarEnv(envCompleto()).faltantes).toEqual([]);
  });

  test('lista TODAS las variables faltantes con su explicacion, no solo la primera', () => {
    const env = envCompleto();
    delete env.OPENAI_API_KEY;
    delete env.TELEGRAM_BOT_TOKEN;
    const { faltantes } = validarEnv(env);
    expect(faltantes.map((f) => f.nombre)).toEqual(['OPENAI_API_KEY', 'TELEGRAM_BOT_TOKEN']);
    for (const faltante of faltantes) {
      expect(faltante.para.length).toBeGreaterThan(0);
    }
  });

  test('una variable presente pero vacia cuenta como faltante', () => {
    const env = envCompleto();
    env.GITHUB_TOKEN = '   ';
    expect(validarEnv(env).faltantes.map((f) => f.nombre)).toEqual(['GITHUB_TOKEN']);
  });

  test('acepta variables extra requeridas (SUPABASE_DB_URL para el setup)', () => {
    const env = envCompleto();
    const { faltantes } = validarEnv(env, ['SUPABASE_DB_URL']);
    expect(faltantes.map((f) => f.nombre)).toEqual(['SUPABASE_DB_URL']);
  });
});
