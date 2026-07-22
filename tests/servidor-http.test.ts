import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { crearServidorHttp } from '../src/index.js';

const SECRETO = 'secreto-compartido-sintetico';
const SECRETO_API = 'secreto-api-sintetico';

const manejarEventoGitHub = vi.fn(async () => ({ documentos: 2, rechazados: 0 }));
const manejarBusqueda = vi.fn(
  async (_cuerpo: unknown): Promise<{ status: number; cuerpo: Record<string, unknown> }> => ({
    status: 200,
    cuerpo: { encontrado: true, resultados: [{ contenido: 'contenido exacto' }] },
  })
);
const sincronizarNotion = vi.fn(async () => ({ procesados: 2, omitidos: 1, rechazados: 0, borrados: 0 }));
const sincronizarN8n = vi.fn(async () => ({ procesados: 1, omitidos: 0, rechazados: 0, borrados: 1 }));
const manejarLoteClaudeCode = vi.fn(
  async (_cuerpo: unknown): Promise<{ status: number; cuerpo: Record<string, unknown> }> => ({
    status: 200,
    cuerpo: { procesados: 3, omitidos: 0, rechazados: 0, borrados: 0 },
  })
);

let servidor: Server;
let base: string;

beforeAll(async () => {
  servidor = crearServidorHttp({
    secretoWebhook: SECRETO,
    secretoApi: SECRETO_API,
    manejarEventoGitHub,
    manejarBusqueda,
    sincronizarNotion,
    sincronizarN8n,
    manejarLoteClaudeCode,
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const { port } = servidor.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => servidor.close(resolve));
});

describe('servidor HTTP interno (payloads reenviados por n8n)', () => {
  test('GET /salud responde 200', async () => {
    const respuesta = await fetch(`${base}/salud`);
    expect(respuesta.status).toBe(200);
  });

  test('POST /ingesta/github sin el header de secreto responde 401 y no procesa nada', async () => {
    manejarEventoGitHub.mockClear();
    const respuesta = await fetch(`${base}/ingesta/github`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commits: [] }),
    });
    expect(respuesta.status).toBe(401);
    expect(manejarEventoGitHub).not.toHaveBeenCalled();
  });

  test('POST /ingesta/github con secreto equivocado responde 401', async () => {
    const respuesta = await fetch(`${base}/ingesta/github`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-guantera-secret': 'incorrecto' },
      body: JSON.stringify({ commits: [] }),
    });
    expect(respuesta.status).toBe(401);
  });

  test('POST /ingesta/github con el secreto correcto procesa el payload', async () => {
    manejarEventoGitHub.mockClear();
    const payload = { repository: { full_name: 'x/y' }, commits: [] };
    const respuesta = await fetch(`${base}/ingesta/github`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-guantera-secret': SECRETO },
      body: JSON.stringify(payload),
    });
    expect(respuesta.status).toBe(200);
    expect(manejarEventoGitHub).toHaveBeenCalledWith(payload);
    const cuerpo = await respuesta.json();
    expect(cuerpo).toMatchObject({ documentos: 2 });
  });

  test('un cuerpo que no es JSON responde 400', async () => {
    const respuesta = await fetch(`${base}/ingesta/github`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-guantera-secret': SECRETO },
      body: 'esto no es json {',
    });
    expect(respuesta.status).toBe(400);
  });

  test('una ruta desconocida responde 404', async () => {
    const respuesta = await fetch(`${base}/otra-cosa`);
    expect(respuesta.status).toBe(404);
  });
});

describe('POST /buscar (API interna para otros agentes)', () => {
  test('sin el header de secreto de API responde 401 y no busca', async () => {
    manejarBusqueda.mockClear();
    const respuesta = await fetch(`${base}/buscar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pregunta: 'x' }),
    });
    expect(respuesta.status).toBe(401);
    expect(manejarBusqueda).not.toHaveBeenCalled();
  });

  test('el secreto de webhook NO sirve para la API de consulta', async () => {
    const respuesta = await fetch(`${base}/buscar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-guantera-api-secret': SECRETO },
      body: JSON.stringify({ pregunta: 'x' }),
    });
    expect(respuesta.status).toBe(401);
  });

  test('con el secreto de API correcto delega en el manejador y devuelve su salida', async () => {
    manejarBusqueda.mockClear();
    const peticion = { pregunta: 'donde quedo la decision del indice?', fuentes: ['github'] };
    const respuesta = await fetch(`${base}/buscar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-guantera-api-secret': SECRETO_API },
      body: JSON.stringify(peticion),
    });
    expect(respuesta.status).toBe(200);
    expect(manejarBusqueda).toHaveBeenCalledWith(peticion);
    expect(await respuesta.json()).toMatchObject({ encontrado: true });
  });

  test('el status que decide el manejador se respeta (400 de validacion)', async () => {
    manejarBusqueda.mockResolvedValueOnce({ status: 400, cuerpo: { error: 'falta pregunta' } });
    const respuesta = await fetch(`${base}/buscar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-guantera-api-secret': SECRETO_API },
      body: JSON.stringify({}),
    });
    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toMatchObject({ error: 'falta pregunta' });
  });

  test('un cuerpo que no es JSON responde 400', async () => {
    const respuesta = await fetch(`${base}/buscar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-guantera-api-secret': SECRETO_API },
      body: 'no es json {',
    });
    expect(respuesta.status).toBe(400);
  });
});

describe('POST /ingesta/claude-code (lote reenviado por n8n desde el colector local)', () => {
  test('sin el secreto de webhook responde 401 y no procesa', async () => {
    manejarLoteClaudeCode.mockClear();
    const respuesta = await fetch(`${base}/ingesta/claude-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentos: [] }),
    });
    expect(respuesta.status).toBe(401);
    expect(manejarLoteClaudeCode).not.toHaveBeenCalled();
  });

  test('con el secreto correcto delega el lote y devuelve el resumen del manejador', async () => {
    manejarLoteClaudeCode.mockClear();
    const lote = { documentos: [{ sourceId: 'ws:memoria.md', contenido: 'hecho' }], manifiesto: ['ws:memoria.md'] };
    const respuesta = await fetch(`${base}/ingesta/claude-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-guantera-secret': SECRETO },
      body: JSON.stringify(lote),
    });
    expect(respuesta.status).toBe(200);
    expect(manejarLoteClaudeCode).toHaveBeenCalledWith(lote);
    expect(await respuesta.json()).toMatchObject({ procesados: 3 });
  });

  test('el status del manejador se respeta (400 de validacion)', async () => {
    manejarLoteClaudeCode.mockResolvedValueOnce({ status: 400, cuerpo: { error: 'faltan documentos' } });
    const respuesta = await fetch(`${base}/ingesta/claude-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-guantera-secret': SECRETO },
      body: JSON.stringify({}),
    });
    expect(respuesta.status).toBe(400);
  });
});

describe('POST /sync/notion y /sync/n8n (disparados por el Schedule Trigger de n8n)', () => {
  test('sin el secreto de webhook responde 401 y no sincroniza', async () => {
    sincronizarNotion.mockClear();
    const respuesta = await fetch(`${base}/sync/notion`, { method: 'POST' });
    expect(respuesta.status).toBe(401);
    expect(sincronizarNotion).not.toHaveBeenCalled();
  });

  test('con el secreto correcto dispara el sync de Notion y devuelve el resumen', async () => {
    const respuesta = await fetch(`${base}/sync/notion`, {
      method: 'POST',
      headers: { 'x-guantera-secret': SECRETO },
    });
    expect(respuesta.status).toBe(200);
    expect(sincronizarNotion).toHaveBeenCalled();
    expect(await respuesta.json()).toEqual({ procesados: 2, omitidos: 1, rechazados: 0, borrados: 0 });
  });

  test('con el secreto correcto dispara el sync de n8n y devuelve el resumen', async () => {
    const respuesta = await fetch(`${base}/sync/n8n`, {
      method: 'POST',
      headers: { 'x-guantera-secret': SECRETO },
    });
    expect(respuesta.status).toBe(200);
    expect(sincronizarN8n).toHaveBeenCalled();
    expect(await respuesta.json()).toEqual({ procesados: 1, omitidos: 0, rechazados: 0, borrados: 1 });
  });

  test('si la fuente no esta configurada responde 503 con un error que dice que variable falta', async () => {
    const sinSync = crearServidorHttp({
      secretoWebhook: SECRETO,
      secretoApi: SECRETO_API,
      manejarEventoGitHub,
      manejarBusqueda,
      manejarLoteClaudeCode,
    });
    await new Promise<void>((resolve) => sinSync.listen(0, '127.0.0.1', resolve));
    const puerto = (sinSync.address() as AddressInfo).port;
    try {
      const respuesta = await fetch(`http://127.0.0.1:${puerto}/sync/notion`, {
        method: 'POST',
        headers: { 'x-guantera-secret': SECRETO },
      });
      expect(respuesta.status).toBe(503);
      expect(await respuesta.json()).toMatchObject({
        error: expect.stringMatching(/NOTION_TOKEN/),
      });
    } finally {
      await new Promise((resolve) => sinSync.close(resolve));
    }
  });
});
