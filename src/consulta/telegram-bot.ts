/**
 * Bot de Telegram — La Guantera
 *
 * Interfaz principal de Fase 1: recibe preguntas en lenguaje natural, las pasa a
 * ./query-engine.ts y responde con el contenido exacto + fuente citada. Tambien
 * recibe notas manuales (texto/voz) y las enruta a ../ingesta/telegram-manual.ts.
 *
 * REQUISITO FIRME, NO NEGOCIABLE (ver docs/BRIEF.md, seccion 8): el bot solo
 * responde y solo acepta notas de chat_id autorizados, empezando por el de
 * Charly. Esto se valida en el primer middleware/handler, antes de tocar
 * query-engine.ts o telegram-manual.ts — el contenido indexado incluye codigo y
 * contexto de negocio, asi que no puede quedar abierto a cualquier usuario.
 *
 * Decision pendiente (ver docs/BRIEF.md, seccion 9.2): reutilizar el bot que ya
 * envia las rutinas diarias (chat_id 742163352) agregando comandos nuevos, o
 * crear un bot dedicado solo para La Guantera. Reutilizar simplifica la gestion
 * de tokens pero mezcla propositos en un solo bot — a resolver antes de programar
 * este modulo, no despues. Cualquiera de las dos opciones debe cumplir el
 * requisito de control de acceso de arriba.
 *
 * Pendiente de modo plan:
 * - Libreria de bot (grammy, telegraf, u otra)
 * - Comandos explicitos (ej. /nota vs. pregunta directa) o deteccion automatica de intencion
 */

export {};
