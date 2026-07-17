# La Guantera

Memoria estructurada y consultable del ecosistema de Charly.marketing — GitHub, n8n/Notion, Claude Code y notas manuales — con búsqueda por significado (embeddings), no por palabra clave.

> Ver el brief completo en [`docs/BRIEF.md`](./docs/BRIEF.md) antes de tocar cualquier código.

## Estado

En planeación (modo plan pendiente). Este README tiene el esqueleto de lo que debe quedar documentado — se llena con pasos reales durante la Fase 1, y se valida instalando desde cero en una máquina limpia antes de darlo por terminado (ver `docs/BRIEF.md`, sección 12).

## Requisitos (a confirmar en modo plan)

- Node.js (versión a definir)
- Cuenta de Supabase con pgvector habilitado
- VPS con n8n corriendo (o equivalente)
- Cuenta del proveedor de embeddings elegido (ver `docs/BRIEF.md`, sección 7.3)
- Bot de Telegram creado vía BotFather

## Instalación

*Pendiente — se completa en Fase 1 con los pasos reales: clonar, `npm install`, configurar `.env`, correr `npm run setup`, conectar el webhook de GitHub en n8n, correr el backfill inicial.*

## Uso

*Pendiente — se completa una vez exista el bot de Telegram funcionando.*

## Stack

TypeScript + Node.js · Supabase/pgvector · Vitest · n8n (orquestación de ingesta) · Telegram (consulta)
