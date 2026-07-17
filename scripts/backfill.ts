/**
 * Backfill inicial — La Guantera
 *
 * Recorre el historial YA EXISTENTE de cada repo de GITHUB_REPOS (commits +
 * snapshot de archivos de HEAD) y lo pasa por el pipeline completo. Sin esto,
 * el bot solo sabria de eventos posteriores al lanzamiento (BRIEF 6.1).
 *
 * Correr con: npm run backfill
 * Es re-ejecutable: el anti re-embedding por content_hash hace que una segunda
 * corrida no pague embeddings ni duplique filas por contenido sin cambios.
 *
 * El log solo muestra sourceIds y conteos — NUNCA contenido (podria haber
 * documentos rechazados justamente por contener secretos).
 */

import { config } from 'dotenv';
import { crearAlmacen, crearClienteSupabase } from '../src/almacenamiento/supabase-client.js';
import { exigirEnv } from '../src/config.js';
import { backfillRepo, crearLectorGitHub } from '../src/ingesta/github.js';
import { crearClienteOpenAI } from '../src/procesamiento/embeddings.js';
import { procesarDocumentos } from '../src/pipeline.js';

async function main(): Promise<void> {
  config();
  exigirEnv();

  const lector = crearLectorGitHub(process.env.GITHUB_TOKEN!);
  const pipeline = {
    almacen: crearAlmacen(crearClienteSupabase()),
    clienteEmbeddings: crearClienteOpenAI(),
  };

  const repos = process.env.GITHUB_REPOS!.split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  let totalChunks = 0;
  for (const repo of repos) {
    console.log(`\n=== Backfill de ${repo} ===`);
    const documentos = await backfillRepo(lector, repo);
    console.log(`Documentos a procesar: ${documentos.length} (commits + snapshot de archivos)`);

    const resultados = await procesarDocumentos(documentos, pipeline);
    const aceptados = resultados.filter((r) => r.aceptado);
    const rechazados = resultados.filter((r) => !r.aceptado);
    const chunks = aceptados.reduce((suma, r) => suma + (r.aceptado ? r.chunksInsertados : 0), 0);
    const duplicados = aceptados.reduce((suma, r) => suma + (r.aceptado ? r.duplicados : 0), 0);
    totalChunks += chunks;

    console.log(`Chunks insertados: ${chunks} (duplicados/omitidos sin re-embeber: ${duplicados})`);
    if (rechazados.length > 0) {
      console.log(`Rechazados por chequeo de secretos: ${rechazados.length}`);
      for (const rechazo of rechazados) {
        if (!rechazo.aceptado) console.log(`  - ${rechazo.sourceId} (${rechazo.patrones.join(', ')})`);
      }
    }
  }

  console.log(`\nBackfill completo: ${totalChunks} chunks nuevos en guantera_chunks.`);
}

main().catch((error) => {
  console.error('[backfill] error fatal:', (error as Error).message);
  process.exit(1);
});
