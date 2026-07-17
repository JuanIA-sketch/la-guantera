/**
 * Embeddings — La Guantera
 *
 * Genera el vector de embedding para cada chunk antes de guardarlo en Supabase.
 *
 * DECISION VERIFICADA (ver docs/BRIEF.md, seccion 7.3): OpenCode Go
 * (https://opencode.ai/zen/go/v1, el endpoint que da acceso a GLM-5.2/DeepSeek)
 * expone unicamente chat/completions compatible con OpenAI, NO un endpoint de
 * embeddings. Por eso este modulo necesita un proveedor de embeddings aparte.
 *
 * Default recomendado: OpenAI text-embedding-3-small (1536 dimensiones,
 * ~$0.02 por millon de tokens). Alternativa mas barata si se quiere exprimir
 * costo: Google text-embedding-005. La dimension del vector en
 * scripts/schema.sql (columna `embedding vector(1536)`) depende directamente
 * de esta decision — ajustar ahi si cambia el proveedor.
 *
 * Pendiente de modo plan:
 * - Confirmar proveedor final (nueva cuenta de OpenAI vs. Google vs. otro)
 * - Manejo de rate limits / reintentos
 * - Cacheo para no regenerar embeddings de contenido sin cambios
 */

export {};
