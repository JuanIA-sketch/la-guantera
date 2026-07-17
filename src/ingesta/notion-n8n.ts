/**
 * Ingesta de n8n / Notion — La Guantera (Fase 2)
 *
 * A diferencia de GitHub, aqui no hay push nativo hacia La Guantera: es un sync
 * periodico disparado por un nodo Schedule Trigger en n8n, que consulta:
 *   - La API de n8n, para workflows y ejecuciones propias
 *   - La API de Notion, para paginas y bases de datos relevantes
 *
 * Ambas fuentes se transforman al mismo formato interno de "documento crudo"
 * antes de pasar por chunking, con source_type = 'n8n' o 'notion' segun corresponda.
 *
 * Pendiente de modo plan:
 * - Frecuencia del sync (diario, cada N horas)
 * - Que bases/paginas de Notion y que workflows de n8n se incluyen
 * - Deduplicacion entre corridas de sync (evitar reprocesar contenido sin cambios)
 * - Mismo tema que en ../ingesta/github.ts: el primer sync debe traer el contenido
 *   YA EXISTENTE en Notion/n8n, no solo lo que cambie de ahi en adelante
 */

export {};
