/**
 * Entry point — La Guantera
 *
 * Cablea los modulos ya probados y arranca los dos servicios de Fase 1:
 *   1. Bot de Telegram (long polling) — consulta + notas manuales
 *   2. Listener HTTP interno (puerto PUERTO_HTTP, default 3012) que recibe el
 *      payload reenviado por n8n desde su GitHub Trigger, autenticado con el
 *      header X-Guantera-Secret (la firma HMAC original de GitHub no sobrevive
 *      el reenvio de n8n; el secreto compartido si).
 *
 * En el VPS se expone SOLO en 172.17.0.1 (HOST_HTTP), mismo patron de red que
 * los demas agentes.
 */

import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { Api } from 'grammy';
import { crearAlmacen, crearClienteSupabase } from './almacenamiento/supabase-client.js';
import { exigirEnv, puertoHttp, umbralSimilitud } from './config.js';
import { manejarBusqueda } from './consulta/api.js';
import { consultar } from './consulta/query-engine.js';
import { crearBot, parsearChatIds } from './consulta/telegram-bot.js';
import {
  archivosTocadosDePush,
  crearLectorGitHub,
  documentoDeArchivo,
  transformarPayloadGitHub,
} from './ingesta/github.js';
import { manejarLoteClaudeCode } from './ingesta/claude-code.js';
import {
  crearLectorN8n,
  crearLectorNotion,
  sincronizarN8n,
  sincronizarNotion,
  type ResumenSync,
} from './ingesta/notion-n8n.js';
import { crearTranscriptorOpenAI } from './ingesta/telegram-manual.js';
import { crearClienteOpenAI } from './procesamiento/embeddings.js';
import { procesarDocumento, procesarDocumentos, type DependenciasPipeline } from './pipeline.js';

export interface DependenciasServidor {
  /** Secreto de ingesta n8n<->Guantera (header X-Guantera-Secret). */
  secretoWebhook: string;
  /** Secreto de la API de consulta para otros agentes (header X-Guantera-Api-Secret). */
  secretoApi: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manejarEventoGitHub(payload: any): Promise<{ documentos: number; rechazados: number }>;
  manejarBusqueda(cuerpo: unknown): Promise<{ status: number; cuerpo: Record<string, unknown> }>;
  /** Ausente = fuente sin configurar en el .env → la ruta responde 503. */
  sincronizarNotion?(): Promise<ResumenSync>;
  sincronizarN8n?(): Promise<ResumenSync>;
  manejarLoteClaudeCode(cuerpo: unknown): Promise<{ status: number; cuerpo: Record<string, unknown> }>;
}

export function crearServidorHttp(deps: DependenciasServidor): Server {
  return createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/salud') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'POST' && req.url === '/ingesta/github') {
        if (req.headers['x-guantera-secret'] !== deps.secretoWebhook) {
          res.writeHead(401);
          res.end();
          return;
        }
        const payload = await leerJson(req);
        if (payload === JSON_INVALIDO) {
          res.writeHead(400);
          res.end();
          return;
        }
        const resultado = await deps.manejarEventoGitHub(payload);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(resultado));
        return;
      }

      if (req.method === 'POST' && req.url === '/ingesta/claude-code') {
        if (req.headers['x-guantera-secret'] !== deps.secretoWebhook) {
          res.writeHead(401);
          res.end();
          return;
        }
        const payload = await leerJson(req);
        if (payload === JSON_INVALIDO) {
          res.writeHead(400);
          res.end();
          return;
        }
        const salida = await deps.manejarLoteClaudeCode(payload);
        res.writeHead(salida.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(salida.cuerpo));
        return;
      }

      if (req.method === 'POST' && (req.url === '/sync/notion' || req.url === '/sync/n8n')) {
        if (req.headers['x-guantera-secret'] !== deps.secretoWebhook) {
          res.writeHead(401);
          res.end();
          return;
        }
        const esNotion = req.url === '/sync/notion';
        const sincronizar = esNotion ? deps.sincronizarNotion : deps.sincronizarN8n;
        if (!sincronizar) {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              error: `Fuente sin configurar: falta ${esNotion ? 'NOTION_TOKEN' : 'N8N_URL y/o N8N_API_KEY'} en el .env.`,
            })
          );
          return;
        }
        const resumen = await sincronizar();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(resumen));
        return;
      }

      if (req.method === 'POST' && req.url === '/buscar') {
        if (req.headers['x-guantera-api-secret'] !== deps.secretoApi) {
          res.writeHead(401);
          res.end();
          return;
        }
        const payload = await leerJson(req);
        if (payload === JSON_INVALIDO) {
          res.writeHead(400);
          res.end();
          return;
        }
        const salida = await deps.manejarBusqueda(payload);
        res.writeHead(salida.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(salida.cuerpo));
        return;
      }

      res.writeHead(404);
      res.end();
    } catch (error) {
      console.error('[http] error:', (error as Error).message);
      res.writeHead(500);
      res.end();
    }
  });
}

function leerCuerpo(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let datos = '';
    req.on('data', (trozo) => (datos += trozo));
    req.on('end', () => resolve(datos));
    req.on('error', reject);
  });
}

/** Centinela: distingue "JSON invalido" de un payload legitimamente null. */
const JSON_INVALIDO = Symbol('json-invalido');

async function leerJson(req: NodeJS.ReadableStream): Promise<unknown | typeof JSON_INVALIDO> {
  try {
    return JSON.parse(await leerCuerpo(req));
  } catch {
    return JSON_INVALIDO;
  }
}

async function main(): Promise<void> {
  const { config } = await import('dotenv');
  config();
  exigirEnv(process.env, ['GUANTERA_API_SECRET']);

  const clienteEmbeddings = crearClienteOpenAI();
  const almacen = crearAlmacen(crearClienteSupabase());
  const lector = crearLectorGitHub(process.env.GITHUB_TOKEN!);
  const transcriptor = crearTranscriptorOpenAI();
  const pipeline: DependenciasPipeline = { almacen, clienteEmbeddings };
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const api = new Api(token);
  const umbral = umbralSimilitud();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function manejarEventoGitHub(payload: any): Promise<{ documentos: number; rechazados: number }> {
    const resultados = await procesarDocumentos(transformarPayloadGitHub(payload), pipeline);

    // push: mantener el snapshot de archivos al dia
    const repo: string | undefined = payload?.repository?.full_name;
    if (Array.isArray(payload?.commits) && repo) {
      const { actualizar, borrar } = archivosTocadosDePush(payload);
      for (const ruta of actualizar) {
        const contenido = await lector.obtenerArchivo(repo, ruta);
        if (contenido === null || !contenido.trim()) continue;
        resultados.push(
          await procesarDocumento(documentoDeArchivo(repo, ruta, contenido), pipeline, {
            reemplazarFuente: true,
          })
        );
      }
      for (const ruta of borrar) {
        await almacen.reemplazarChunksDeFuente('github', `${repo}:${ruta}`, []);
      }
    }

    const rechazados = resultados.filter((r) => !r.aceptado).length;
    return { documentos: resultados.length, rechazados };
  }

  const bot = crearBot({
    token,
    chatIdsAutorizados: parsearChatIds(process.env.TELEGRAM_CHAT_IDS!),
    async procesarNota(doc) {
      const resultado = await procesarDocumento(doc, pipeline);
      return resultado.aceptado
        ? { aceptado: true, chunks: resultado.chunksInsertados }
        : { aceptado: false, patrones: resultado.patrones };
    },
    async responderPregunta(pregunta) {
      const respuesta = await consultar(pregunta, { clienteEmbeddings, almacen, umbral });
      return respuesta.mensaje;
    },
    async transcribir(fileId) {
      const archivo = await api.getFile(fileId);
      const url = `https://api.telegram.org/file/bot${token}/${archivo.file_path}`;
      const respuesta = await fetch(url);
      const datos = new Uint8Array(await respuesta.arrayBuffer());
      return transcriptor.transcribir({ datos, nombre: 'voz.ogg' });
    },
  });

  const host = process.env.HOST_HTTP?.trim() || '127.0.0.1';
  const puerto = puertoHttp();
  // Fuentes de Fase 2 opcionales: sin su env, la ruta /sync/* responde 503 claro.
  const notionToken = process.env.NOTION_TOKEN?.trim();
  const n8nUrl = process.env.N8N_URL?.trim();
  const n8nApiKey = process.env.N8N_API_KEY?.trim();

  const servidor = crearServidorHttp({
    secretoWebhook: process.env.GITHUB_WEBHOOK_SECRET!,
    secretoApi: process.env.GUANTERA_API_SECRET!,
    manejarEventoGitHub,
    manejarBusqueda: (cuerpo) => manejarBusqueda(cuerpo, { clienteEmbeddings, almacen }),
    manejarLoteClaudeCode: (cuerpo) => manejarLoteClaudeCode(cuerpo, pipeline),
    sincronizarNotion: notionToken
      ? () => sincronizarNotion(crearLectorNotion(notionToken), pipeline)
      : undefined,
    sincronizarN8n:
      n8nUrl && n8nApiKey
        ? () => sincronizarN8n(crearLectorN8n(n8nUrl, n8nApiKey), n8nUrl, pipeline)
        : undefined,
  });
  servidor.listen(puerto, host, () => {
    console.log(
      `[http] escuchando en ${host}:${puerto} ` +
        '(POST /ingesta/github, /ingesta/claude-code, /sync/notion, /sync/n8n, /buscar; GET /salud)'
    );
  });

  console.log('[bot] arrancando long polling...');
  await bot.start();
}

const esEjecucionDirecta =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (esEjecucionDirecta) {
  main().catch((error) => {
    console.error('[main] error fatal:', (error as Error).message);
    process.exit(1);
  });
}
