/**
 * Motor de consulta — La Guantera
 *
 * Recibe una pregunta en lenguaje natural, genera su embedding (mismo proveedor
 * que ../procesamiento/embeddings.ts, para que la busqueda por similitud tenga
 * sentido) y busca los chunks mas cercanos en `guantera_chunks`.
 *
 * Devuelve el CONTENIDO EXACTO del chunk mas relevante + su fuente citada
 * (source_type, source_url) — nunca un resumen. Ese es el diferencial explicito
 * frente a la memoria de Claude (ver docs/BRIEF.md, seccion 4).
 *
 * Usado tanto por el bot de Telegram (Fase 1) como por la API interna (Fase 2) —
 * es la capa compartida entre ambas interfaces de consulta.
 *
 * Pendiente de modo plan:
 * - Numero de resultados a devolver por consulta (top-k)
 * - Umbral minimo de similitud antes de responder "no encontre nada relevante"
 * - (Fase 2, opcional) reranking simple si el top-k no es suficientemente preciso
 */

export {};
