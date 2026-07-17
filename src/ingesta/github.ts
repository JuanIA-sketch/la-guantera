/**
 * Ingesta de GitHub — La Guantera
 *
 * Tiene DOS responsabilidades, no una:
 *
 * 1. Backfill inicial: recorrer el historial YA EXISTENTE de cada repo elegido vía
 *    la API de GitHub (REST o GraphQL). El GitHub Trigger de n8n (ver mas abajo)
 *    NO trae nada de esto — solo dispara con eventos nuevos hacia adelante. Sin
 *    este backfill, el bot solo podria responder sobre commits posteriores al
 *    lanzamiento, lo cual no resuelve el dolor real (encontrar decisiones ya tomadas).
 * 2. Ingesta hacia adelante: recibe el payload que reenvia el nodo GitHub Trigger
 *    de n8n (push, pull_request, issues) y lo transforma al formato interno de
 *    "documento crudo" que consume el pipeline de chunking (ver ../procesamiento/chunking.ts).
 *
 * No implementa recepcion de webhooks propia para el punto 2: n8n ya hace ese
 * trabajo (nodo nativo GitHub Trigger). Este modulo solo procesa el payload que
 * n8n reenvia, ademas de correr el backfill del punto 1.
 *
 * Pendiente de modo plan (ver docs/BRIEF.md, seccion 9):
 * - Que repos de JuanIA-sketch se incluyen en Fase 1 (recomendado: solo los activos de julio)
 * - Cuanto historial se hace backfill (todo vs. ultimos N meses)
 * - Si se indexa el diff completo o solo mensaje de commit + archivos tocados
 * - Aplicar el chequeo de secretos (grep -l/-q) ANTES de pasar contenido al chunking,
 *   tanto en el backfill como en la ingesta hacia adelante
 */

export {};
