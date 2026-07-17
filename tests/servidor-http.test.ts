import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { crearServidorHttp } from '../src/index.js';

const SECRETO = 'secreto-compartido-sintetico';

const manejarEventoGitHub = vi.fn(async () => ({ documentos: 2, rechazados: 0 }));

let servidor: Server;
let base: string;

beforeAll(async () => {
  servidor = crearServidorHttp({ secretoWebhook: SECRETO, manejarEventoGitHub });
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
