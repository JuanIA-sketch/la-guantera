/**
 * Setup — La Guantera
 *
 * Que instalar no dependa de pasos manuales evitables (BRIEF 12):
 *   1. Valida TODAS las variables de entorno (incluida SUPABASE_DB_URL, que
 *      solo se usa aqui) y falla rapido listando lo que falte y para que sirve.
 *   2. Aplica scripts/schema.sql contra Supabase con un solo comando, via
 *      conexion directa de Postgres (supabase-js no ejecuta SQL arbitrario).
 *      El schema es idempotente: correr esto dos veces no rompe nada.
 *
 * Correr con: npm run setup
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import postgres from 'postgres';
import { exigirEnv } from '../src/config.js';

async function main(): Promise<void> {
  config();
  exigirEnv(process.env, ['SUPABASE_DB_URL']);

  const rutaSchema = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');
  const schema = await readFile(rutaSchema, 'utf8');

  console.log('Aplicando scripts/schema.sql contra Supabase...');
  const sql = postgres(process.env.SUPABASE_DB_URL!, {
    max: 1,
    onnotice: () => {}, // silencia los NOTICE de "already exists" del schema idempotente
  });
  try {
    await sql.unsafe(schema);
  } finally {
    await sql.end();
  }

  console.log('Schema aplicado: tabla guantera_chunks + indices + RPC guantera_buscar listos.');
  console.log('\nSiguientes pasos (ver README):');
  console.log('  1. npm run backfill   — carga inicial del historial de GITHUB_REPOS');
  console.log('  2. npm run dev        — arranca el bot y el listener HTTP para n8n');
}

main().catch((error) => {
  console.error('[setup] error:', (error as Error).message);
  process.exit(1);
});
