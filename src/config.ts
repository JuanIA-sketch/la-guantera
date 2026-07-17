/**
 * Configuracion y validacion de entorno — La Guantera
 *
 * Fallar rapido y con mensaje claro (BRIEF 12): tanto `npm run setup` como el
 * servicio (src/index.ts) y el backfill validan TODO el entorno antes de
 * arrancar — nunca a medio camino de una ingesta.
 */

export interface VariableEnv {
  nombre: string;
  /** Para que sirve — se muestra en el mensaje de error si falta. */
  para: string;
}

const TODAS: VariableEnv[] = [
  { nombre: 'SUPABASE_URL', para: 'URL del proyecto de Supabase (el mismo de charly-prospecting)' },
  { nombre: 'SUPABASE_SERVICE_ROLE_KEY', para: 'service role key de Supabase para leer/escribir guantera_chunks' },
  { nombre: 'SUPABASE_DB_URL', para: 'connection string directa de Postgres — solo la usa npm run setup para aplicar schema.sql' },
  { nombre: 'OPENAI_API_KEY', para: 'embeddings (text-embedding-3-small) y transcripcion de voz (gpt-4o-mini-transcribe)' },
  { nombre: 'TELEGRAM_BOT_TOKEN', para: 'token del bot dedicado de La Guantera (BotFather)' },
  { nombre: 'TELEGRAM_CHAT_IDS', para: 'chat_id autorizados separados por coma — el bot ignora al resto' },
  { nombre: 'GITHUB_TOKEN', para: 'PAT con permiso de LECTURA sobre los repos de GITHUB_REPOS (backfill)' },
  { nombre: 'GITHUB_WEBHOOK_SECRET', para: 'secreto compartido del header X-Guantera-Secret que manda n8n' },
  { nombre: 'GITHUB_REPOS', para: 'repos a indexar, separados por coma, formato owner/repo' },
];

/** Requeridas para arrancar el servicio y el backfill (SUPABASE_DB_URL es solo del setup). */
export const VARIABLES_FASE_1: VariableEnv[] = TODAS.filter((v) => v.nombre !== 'SUPABASE_DB_URL');

export function validarEnv(
  env: Record<string, string | undefined> = process.env,
  extras: string[] = []
): { faltantes: VariableEnv[] } {
  const requeridas = [
    ...VARIABLES_FASE_1,
    ...extras.map((nombre) => TODAS.find((v) => v.nombre === nombre) ?? { nombre, para: '' }),
  ];
  const faltantes = requeridas.filter((v) => !env[v.nombre]?.trim());
  return { faltantes };
}

/** Imprime las faltantes y termina el proceso — para los puntos de entrada. */
export function exigirEnv(env: Record<string, string | undefined> = process.env, extras: string[] = []): void {
  const { faltantes } = validarEnv(env, extras);
  if (faltantes.length === 0) return;
  console.error('Faltan variables de entorno (revisa tu .env, hay ejemplo en .env.example):\n');
  for (const variable of faltantes) {
    console.error(`  - ${variable.nombre}: ${variable.para}`);
  }
  process.exit(1);
}

export function puertoHttp(env: Record<string, string | undefined> = process.env): number {
  const puerto = Number(env.PUERTO_HTTP);
  return Number.isInteger(puerto) && puerto > 0 ? puerto : 3012;
}

export function umbralSimilitud(env: Record<string, string | undefined> = process.env): number {
  const umbral = Number(env.UMBRAL_SIMILITUD);
  return Number.isFinite(umbral) && umbral > 0 && umbral < 1 ? umbral : 0.35;
}
