/**
 * Ingesta manual por Telegram — La Guantera
 *
 * Recibe notas sueltas escritas o dictadas por voz directamente al bot de Telegram
 * y las transforma al mismo formato interno de "documento crudo" que las demas
 * fuentes, con source_type = 'telegram_manual'.
 *
 * Es la fuente mas simple del proyecto: no depende de sincronizacion externa ni
 * de infraestructura adicional, solo del bot ya definido en ../consulta/telegram-bot.ts
 * (mismo bot para ingesta y consulta, o uno dedicado — ver decision pendiente #2
 * en docs/BRIEF.md seccion 9).
 *
 * Pendiente de modo plan:
 * - Transcripcion de voz a texto (que servicio se usa)
 * - Formato de confirmacion al usuario tras guardar una nota
 */

export {};
