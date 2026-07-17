import { describe, expect, test } from 'vitest';
import { chequearSecretos } from '../../src/procesamiento/chequeo-secretos.js';

// TODOS los secretos de este archivo son fixtures sinteticos (no negociable,
// ver docs/BRIEF.md seccion 13). Ninguno es una credencial real.

const AWS_FALSA = 'AKIA' + 'FAKEFAKEFAKEFAKE'; // patron AKIA + 16 mayusculas/digitos
const GITHUB_FALSO = 'ghp_' + 'FakeFakeFakeFakeFakeFakeFakeFakeFake';
const OPENAI_FALSA = 'sk-' + 'fakefakefakefakefakefakefake';
const TELEGRAM_FALSO = '123456789:AA' + 'FakeFakeFakeFakeFakeFakeFakeFakeF';
const JWT_FALSO = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiZmFrZSJ9.abcdefghijklmnop_-123';

describe('chequearSecretos', () => {
  test('contenido limpio pasa sin detecciones', () => {
    const resultado = chequearSecretos(
      'Decidimos usar HNSW con vector_cosine_ops porque el volumen es personal.'
    );
    expect(resultado.tieneSecretos).toBe(false);
    expect(resultado.patronesDetectados).toEqual([]);
  });

  test('detecta una AWS access key', () => {
    const resultado = chequearSecretos(`config con clave ${AWS_FALSA} adentro`);
    expect(resultado.tieneSecretos).toBe(true);
    expect(resultado.patronesDetectados).toContain('aws_access_key');
  });

  test('detecta un token de GitHub', () => {
    const resultado = chequearSecretos(`export GITHUB_TOKEN=${GITHUB_FALSO}`);
    expect(resultado.tieneSecretos).toBe(true);
    expect(resultado.patronesDetectados).toContain('github_token');
  });

  test('detecta una clave de OpenAI', () => {
    const resultado = chequearSecretos(`la clave es ${OPENAI_FALSA}`);
    expect(resultado.tieneSecretos).toBe(true);
    expect(resultado.patronesDetectados).toContain('openai_key');
  });

  test('detecta un token de bot de Telegram', () => {
    const resultado = chequearSecretos(`bot token: ${TELEGRAM_FALSO}`);
    expect(resultado.tieneSecretos).toBe(true);
    expect(resultado.patronesDetectados).toContain('telegram_bot_token');
  });

  test('detecta una clave privada PEM', () => {
    // encabezado partido para que el propio escaneo de secretos del repo no marque este fixture
    const pemFalso = '-----BEGIN RSA ' + 'PRIVATE KEY-----\nMIIfake\n-----END RSA ' + 'PRIVATE KEY-----';
    const resultado = chequearSecretos(pemFalso);
    expect(resultado.tieneSecretos).toBe(true);
    expect(resultado.patronesDetectados).toContain('clave_privada_pem');
  });

  test('detecta un JWT', () => {
    const resultado = chequearSecretos(`Authorization: Bearer ${JWT_FALSO}`);
    expect(resultado.tieneSecretos).toBe(true);
    expect(resultado.patronesDetectados).toContain('jwt');
  });

  test('detecta una URL con usuario:clave embebidos', () => {
    const resultado = chequearSecretos(
      'conectate a postgres://admin:clavefalsa123@db.ejemplo.com:5432/base'
    );
    expect(resultado.tieneSecretos).toBe(true);
    expect(resultado.patronesDetectados).toContain('url_con_credenciales');
  });

  test('el resultado NUNCA incluye el texto del secreto detectado', () => {
    const resultado = chequearSecretos(`clave ${AWS_FALSA} y token ${GITHUB_FALSO}`);
    const serializado = JSON.stringify(resultado);
    expect(serializado).not.toContain(AWS_FALSA);
    expect(serializado).not.toContain(GITHUB_FALSO);
  });

  test('no da falso positivo con codigo que lee variables de entorno', () => {
    const codigo = [
      'const apiKey = process.env.OPENAI_API_KEY;',
      'const token = obtenerToken();',
      'TELEGRAM_BOT_TOKEN=',
    ].join('\n');
    const resultado = chequearSecretos(codigo);
    expect(resultado.tieneSecretos).toBe(false);
  });

  test('reporta cada patron una sola vez aunque haya varias coincidencias', () => {
    const resultado = chequearSecretos(`${AWS_FALSA} y otra ${'AKIA' + 'FAKEFAKEFAKEFAKF'}`);
    expect(
      resultado.patronesDetectados.filter((p) => p === 'aws_access_key')
    ).toHaveLength(1);
  });
});
