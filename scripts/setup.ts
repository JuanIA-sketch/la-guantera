/**
 * Setup — La Guantera
 *
 * Objetivo: que instalar el sistema no dependa de pasos manuales evitables
 * (ver docs/BRIEF.md, seccion 12 - "Instalacion y facilidad de uso").
 *
 * Responsabilidades de este script:
 *   1. Validar que todas las variables de entorno requeridas esten presentes
 *      ANTES de arrancar nada (fallar rapido con un mensaje claro, no a medio
 *      camino de una ingesta o del bot ya corriendo).
 *   2. Aplicar scripts/schema.sql contra Supabase con un solo comando, en vez
 *      de pedirle a quien instala que copie/pegue SQL a mano en el editor.
 *
 * Correr con: npm run setup (agregar el script correspondiente a package.json
 * una vez este implementado).
 *
 * Pendiente de modo plan:
 * - Libreria para aplicar SQL contra Supabase (cliente de Postgres directo vs.
 *   la API de administracion de Supabase)
 * - Formato exacto de los mensajes de error cuando falta una variable de entorno
 */

export {};
