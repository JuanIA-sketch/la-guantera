/**
 * Chequeo de secretos — La Guantera
 *
 * Primera etapa del pipeline (BRIEF 7.1, no negociable): NINGUN contenido pasa
 * al chunking sin antes verificar que no contenga credenciales. Un documento
 * con secreto se rechaza COMPLETO — no se intenta "limpiar".
 *
 * Regla equivalente al `grep -l`/`grep -q` del resto del stack: el resultado
 * solo dice QUE patron se detecto, nunca QUE texto hizo match. El secreto no
 * debe aparecer en logs, errores ni resultados.
 */

export interface ResultadoChequeo {
  tieneSecretos: boolean;
  /** Nombres de los patrones detectados (unicos) — nunca el texto que hizo match. */
  patronesDetectados: string[];
}

const PATRONES: ReadonlyArray<{ nombre: string; regex: RegExp }> = [
  { nombre: 'aws_access_key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { nombre: 'github_token', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { nombre: 'openai_key', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { nombre: 'telegram_bot_token', regex: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/ },
  { nombre: 'clave_privada_pem', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    nombre: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  },
  {
    // usuario:clave@host en cualquier URL (postgres://, https://, redis://, ...)
    nombre: 'url_con_credenciales',
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
  },
];

export function chequearSecretos(contenido: string): ResultadoChequeo {
  const patronesDetectados = PATRONES.filter(({ regex }) => regex.test(contenido)).map(
    ({ nombre }) => nombre
  );
  return { tieneSecretos: patronesDetectados.length > 0, patronesDetectados };
}
