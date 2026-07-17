/**
 * API interna — La Guantera (Fase 2)
 *
 * Expone ./query-engine.ts por HTTP para que otros agentes del stack de Charly
 * (el orquestador de charly-marketing, charly-prospecting, etc.) puedan consultar
 * La Guantera directamente, como una base de conocimiento compartida del negocio.
 *
 * Mismo patron de red que los demas agentes del VPS: expuesta solo internamente
 * (172.17.0.1), nunca publica directamente — el acceso externo, si llega a
 * necesitarse, pasa por n8n como con todo lo demas.
 *
 * Pendiente de modo plan:
 * - Puerto asignado (siguiente disponible tras el rango 3000-3011 ya usado)
 * - Formato exacto de respuesta (JSON con content + source + score de similitud)
 * - Autenticacion minima entre agentes internos, aunque no sea publica
 */

export {};
