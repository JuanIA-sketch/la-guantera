/**
 * Cliente de Supabase — La Guantera
 *
 * Reutiliza el MISMO proyecto de Supabase que ya usa charly-prospecting (no uno
 * nuevo), escribiendo en una tabla separada: `guantera_chunks` (ver
 * scripts/schema.sql para el esquema completo, indice HNSW con vector_cosine_ops).
 *
 * Responsabilidades de este modulo:
 *   - Insertar chunks + su embedding + metadata
 *   - Consultar por similitud semantica (nearest neighbor sobre `embedding`)
 *   - Filtrar por source_type y rango de fecha (Fase 2)
 *
 * Pendiente de modo plan:
 * - Nombre exacto de la funcion RPC de busqueda semantica (si se usa una funcion
 *   de Postgres en vez de construir la query desde el cliente)
 * - Manejo de upserts para evitar duplicados en re-sincronizaciones
 */

export {};
