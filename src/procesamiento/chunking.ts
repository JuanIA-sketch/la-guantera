/**
 * Chunking — La Guantera
 *
 * Recibe un "documento crudo" (de cualquier fuente) y lo parte en fragmentos
 * (chunks) del tamano adecuado para generar embeddings utiles.
 *
 * Estrategia diferenciada segun tipo de fuente (ver docs/BRIEF.md, seccion 7.2):
 *   - Codigo (GitHub): por archivo o por funcion, con overlap pequeño
 *   - Texto libre (notas, Notion, conversaciones): por parrafo o quiebre semantico,
 *     ~400-600 tokens con solapamiento de 50-100 tokens
 *
 * IMPORTANTE: el chequeo de secretos (grep -l/-q) debe correr ANTES de esta etapa,
 * no despues — un chunk ya generado a partir de una credencial filtrada es igual
 * de problematico que el documento original.
 *
 * Pendiente de modo plan:
 * - Libreria/heuristica exacta de tokenizacion para medir tamano de chunk
 * - Manejo de documentos mas cortos que el tamano minimo de chunk
 */

export {};
