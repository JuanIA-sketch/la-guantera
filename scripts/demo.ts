/**
 * Demo offline — La Guantera
 *
 * Recorre el flujo completo de Fase 1 SIN tocar ningun servicio externo:
 * embeddings falsos deterministas (bolsa de palabras) + almacen en memoria,
 * pero los modulos reales de pipeline, consulta, bot y listener HTTP.
 *
 * Todos los datos son fixtures sinteticos. Correr con: npx tsx scripts/demo.ts
 * (no necesita .env — esa es la gracia).
 */

import type { AddressInfo } from 'node:net';
import type { AlmacenGuantera } from '../src/almacenamiento/supabase-client.js';
import { consultar } from '../src/consulta/query-engine.js';
import { crearBot } from '../src/consulta/telegram-bot.js';
import { crearServidorHttp } from '../src/index.js';
import type { ClienteEmbeddings } from '../src/procesamiento/embeddings.js';
import { procesarDocumento, procesarDocumentos } from '../src/pipeline.js';
import type { ChunkConEmbedding, DocumentoCrudo, ResultadoBusqueda } from '../src/tipos.js';

// ---------- dobles deterministas (sin red) ----------

/** Embedding falso: bolsa de palabras (sin stopwords) hasheada a 512 dims, normalizada. */
const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'al', 'a', 'en', 'con',
  'para', 'por', 'que', 'es', 'y', 'o', 'se', 'su', 'lo', 'como',
]);

function vectorDe(texto: string): number[] {
  const vector = new Array<number>(512).fill(0);
  const palabras = (texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .match(/[a-z0-9]+/g) ?? []).filter((p) => !STOPWORDS.has(p));
  for (const palabra of palabras) {
    let hash = 5381;
    for (const caracter of palabra) hash = ((hash * 33) ^ caracter.charCodeAt(0)) >>> 0;
    vector[hash % 512] += 1;
  }
  const norma = Math.sqrt(vector.reduce((suma, x) => suma + x * x, 0)) || 1;
  return vector.map((x) => x / norma);
}

let llamadasEmbeddings = 0;
const clienteEmbeddings: ClienteEmbeddings = {
  embeddings: {
    async create({ input }) {
      llamadasEmbeddings++;
      const textos = Array.isArray(input) ? input : [input];
      return { data: textos.map((texto, index) => ({ index, embedding: vectorDe(texto) })) };
    },
  },
};

function crearAlmacenEnMemoria(): AlmacenGuantera & { filas: ChunkConEmbedding[] } {
  const filas: ChunkConEmbedding[] = [];
  const clave = (c: ChunkConEmbedding) => `${c.sourceType}|${c.sourceId}|${c.contentHash}`;
  return {
    filas,
    async insertarChunks(chunks) {
      const existentes = new Set(filas.map(clave));
      const nuevos = chunks.filter((c) => !existentes.has(clave(c)));
      filas.push(...nuevos);
      return { insertados: nuevos.length, duplicados: chunks.length - nuevos.length };
    },
    async hashesExistentes(hashes) {
      const guardados = new Set(filas.map((f) => f.contentHash));
      return new Set(hashes.filter((h) => guardados.has(h)));
    },
    async reemplazarChunksDeFuente(sourceType, sourceId, chunks) {
      for (let i = filas.length - 1; i >= 0; i--) {
        if (filas[i].sourceType === sourceType && filas[i].sourceId === sourceId) filas.splice(i, 1);
      }
      return this.insertarChunks(chunks);
    },
    async buscarPorSimilitud(embedding, limite, umbral) {
      return filas
        .map((fila): ResultadoBusqueda => ({
          id: fila.contentHash.slice(0, 8),
          contenido: fila.contenido,
          sourceType: fila.sourceType,
          sourceId: fila.sourceId,
          sourceUrl: fila.sourceUrl,
          metadata: fila.metadata,
          similitud: fila.embedding.reduce((suma, x, i) => suma + x * (embedding[i] ?? 0), 0),
        }))
        .filter((r) => r.similitud >= umbral)
        .sort((a, b) => b.similitud - a.similitud)
        .slice(0, limite);
    },
  };
}

// umbral bajo porque el embedder falso solo mide solapamiento de palabras;
// el real (text-embedding-3-small) captura significado y usa 0.35
const UMBRAL_DEMO = 0.15;

function titulo(texto: string): void {
  console.log(`\n=== ${texto} ===`);
}

async function main(): Promise<void> {
  const almacen = crearAlmacenEnMemoria();
  const pipeline = { almacen, clienteEmbeddings };

  // ---------- 1. ingesta (backfill simulado con documentos sinteticos) ----------
  titulo('1. Ingesta: 3 documentos sinteticos (2 commits + 1 nota)');
  const documentos: DocumentoCrudo[] = [
    {
      sourceType: 'github',
      sourceId: 'aaa111',
      sourceUrl: 'https://github.com/JuanIA-sketch/demo/commit/aaa111',
      contenido:
        'Decidimos usar HNSW con vector_cosine_ops para el indice vectorial porque el volumen es personal.\n\nArchivos tocados:\n- scripts/schema.sql',
      tipoContenido: 'texto',
      metadata: { repo: 'JuanIA-sketch/demo', autor: 'charly' },
    },
    {
      sourceType: 'github',
      sourceId: 'bbb222',
      sourceUrl: 'https://github.com/JuanIA-sketch/demo/commit/bbb222',
      contenido:
        'El bot de Telegram solo responde a chat_id autorizados, descarte silencioso del resto.\n\nArchivos tocados:\n- src/consulta/telegram-bot.ts',
      tipoContenido: 'texto',
      metadata: { repo: 'JuanIA-sketch/demo', autor: 'charly' },
    },
    {
      sourceType: 'telegram_manual',
      sourceId: 'telegram:111222333:7',
      contenido: 'El puerto del listener HTTP de la guantera es el 3012.',
      tipoContenido: 'texto',
      metadata: { fecha: '2026-07-16T12:00:00Z' },
    },
  ];
  const resultados = await procesarDocumentos(documentos, pipeline);
  console.log(
    `Insertados: ${resultados.filter((r) => r.aceptado).length} documentos, ` +
      `${almacen.filas.length} chunks, ${llamadasEmbeddings} llamadas de embeddings`
  );

  // ---------- 2. chequeo de secretos ----------
  titulo('2. Chequeo de secretos: documento con credencial sintetica');
  const conSecreto = await procesarDocumento(
    {
      sourceType: 'telegram_manual',
      sourceId: 'telegram:111222333:8',
      contenido: `apuntar esta clave: ${'AKIA' + 'FAKEFAKEFAKEFAKE'}`,
      tipoContenido: 'texto',
      metadata: {},
    },
    pipeline
  );
  console.log('Resultado:', JSON.stringify(conSecreto));
  console.log(`Chunks en el almacen (sin cambios): ${almacen.filas.length}`);

  // ---------- 3. anti re-embedding ----------
  titulo('3. Anti re-embedding: re-procesar los mismos 3 documentos');
  const antes = llamadasEmbeddings;
  const reproceso = await procesarDocumentos(documentos, pipeline);
  const duplicados = reproceso.reduce((suma, r) => (r.aceptado ? suma + r.duplicados : suma), 0);
  console.log(
    `Duplicados detectados: ${duplicados} — llamadas de embeddings nuevas: ${llamadasEmbeddings - antes} (cero = no se paga dos veces)`
  );

  // ---------- 4. consulta semantica ----------
  titulo('4. Consulta: "donde quedo la decision del indice HNSW?"');
  const respuesta = await consultar('donde quedo la decision del indice HNSW?', {
    clienteEmbeddings,
    almacen,
    umbral: UMBRAL_DEMO,
  });
  console.log(respuesta.mensaje);

  // ---------- 5. bot: control de acceso + /nota + pregunta ----------
  titulo('5. Bot de Telegram (simulado, sin red)');
  const enviados: string[] = [];
  const bot = crearBot({
    token: 'token-sintetico-demo',
    chatIdsAutorizados: [111222333],
    procesarNota: async (doc) => {
      const r = await procesarDocumento(doc, pipeline);
      return r.aceptado
        ? { aceptado: true, chunks: r.chunksInsertados }
        : { aceptado: false, patrones: r.patrones };
    },
    responderPregunta: async (pregunta) =>
      (await consultar(pregunta, { clienteEmbeddings, almacen, umbral: UMBRAL_DEMO })).mensaje,
    transcribir: async () => 'nunca se llama en esta demo',
    botInfo: {
      id: 42, is_bot: true, first_name: 'GuanteraDemo', username: 'guantera_demo_bot',
      can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
      can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false,
      allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false,
    },
  });
  bot.api.config.use(async (_prev, metodo, payload) => {
    if (metodo === 'sendMessage') enviados.push((payload as { text: string }).text);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ok: true, result: true } as any;
  });

  const mensaje = (chatId: number, texto: string, id: number) => ({
    update_id: id,
    message: {
      message_id: id, date: 1784160000, text: texto,
      chat: { id: chatId, type: 'private' as const, first_name: 'demo' },
      from: { id: chatId, is_bot: false, first_name: 'demo' },
      ...(texto.startsWith('/')
        ? { entities: [{ type: 'bot_command' as const, offset: 0, length: texto.split(' ')[0].length }] }
        : {}),
    },
  });

  await bot.handleUpdate(mensaje(999999999, 'hola, dame acceso a la memoria', 1));
  console.log(`chat_id intruso (999999999): respuestas enviadas = ${enviados.length} (descarte silencioso)`);

  await bot.handleUpdate(mensaje(111222333, '/nota el deploy de la guantera se hace con pm2', 2));
  console.log(`chat_id autorizado, /nota → "${enviados.at(-1)}"`);

  await bot.handleUpdate(mensaje(111222333, 'como se hace el deploy de la guantera?', 3));
  console.log(`chat_id autorizado, pregunta → respuesta:\n---\n${enviados.at(-1)}\n---`);

  // ---------- 6. listener HTTP para n8n ----------
  titulo('6. Listener HTTP (payload reenviado por n8n)');
  const servidor = crearServidorHttp({
    secretoWebhook: 'secreto-demo',
    manejarEventoGitHub: async (payload) => {
      const r = await procesarDocumentos(
        (await import('../src/ingesta/github.js')).transformarPayloadGitHub(payload),
        pipeline
      );
      return { documentos: r.length, rechazados: r.filter((x) => !x.aceptado).length };
    },
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const puerto = (servidor.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${puerto}`;

  const sinSecreto = await fetch(`${base}/ingesta/github`, { method: 'POST', body: '{}' });
  console.log(`POST /ingesta/github sin header de secreto → ${sinSecreto.status}`);

  const push = {
    repository: { full_name: 'JuanIA-sketch/demo' },
    commits: [{
      id: 'ccc333', message: 'Se agrego el umbral de similitud configurable',
      timestamp: '2026-07-16T13:00:00Z', url: 'https://github.com/JuanIA-sketch/demo/commit/ccc333',
      author: { username: 'charly' }, added: [], modified: ['src/config.ts'], removed: [],
    }],
  };
  const conSecretoHttp = await fetch(`${base}/ingesta/github`, {
    method: 'POST',
    headers: { 'x-guantera-secret': 'secreto-demo' },
    body: JSON.stringify(push),
  });
  console.log(`POST con secreto correcto → ${conSecretoHttp.status} ${JSON.stringify(await conSecretoHttp.json())}`);
  await new Promise((resolve) => servidor.close(resolve));

  titulo('Demo completa');
  console.log(`Chunks totales en el almacen en memoria: ${almacen.filas.length}`);
  console.log('Con .env real: npm run setup → npm run backfill → npm run dev (ver README).');
}

main().catch((error) => {
  console.error('[demo] error:', error);
  process.exit(1);
});
