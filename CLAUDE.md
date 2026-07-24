# La Guantera — Contexto para Claude Code

Antes de cualquier tarea, lee `docs/BRIEF.md` completo — es la fuente de verdad del
proyecto (arquitectura, fuentes de ingesta, pipeline, fases, decisiones abiertas).
Revisa también los archivos stub en `src/` (cada uno documenta su propia responsabilidad
y sus pendientes) y `scripts/schema.sql`.

## Estado actual
**Fase 1 completa, validada y en producción** (julio 2026). Implementada con TDD
rojo→verde (Vitest), instalación validada por Charly desde cero con claves reales,
historia de git auditada (cero secretos en todos los blobs) y repo público en
`JuanIA-sketch/la-guantera`.

Producción: VPS de Hostinger, proceso PM2 (`la-guantera`, `npm run build` + `node
dist/index.js`), puerto 3013 expuesto solo en 172.17.0.1, workflow de n8n (GitHub
Trigger → HTTP Request con header `X-Guantera-Secret`) conectado y probado de punta a
punta con un commit real. Ajustes de despliegue ya commiteados: supabase-js fijado en
2.109.0 y transport `ws` explícito, ambos por el Node 20 del VPS.

**Fase 2 desplegada y validada en producción (2026-07-22).**
TDD rojo→verde (Vitest, 145 tests). Incluye: filtros por fuente/fecha en la RPC
`guantera_buscar` (el schema hace `drop` de la firma vieja — re-correr `npm run setup`),
API de consulta `POST /buscar` para otros agentes (header `X-Guantera-Api-Secret`,
nueva var `GUANTERA_API_SECRET` requerida por el servicio), sync periódico
`POST /sync/notion` y `POST /sync/n8n` (polling en La Guantera, n8n solo hace de cron;
503 claro si falta `NOTION_TOKEN` / `N8N_URL`+`N8N_API_KEY`), e ingesta de memorias de
Claude Code: `scripts/colector-claude.ts` corre LOCAL (Task Scheduler) leyendo
`~/.claude/projects/*/memory/*.md` (la convención de la Memoria nativa de Motor
Agéntico 2.0 — NO el live-data.json del aggregator, que va anonimizado y sin contenido)
y manda el lote vía webhook público de n8n a `POST /ingesta/claude-code` con manifiesto
para el sweep de borrados. El Cosechador quedó descartado (no existe en Motor Agéntico
2.0); el brief ya está actualizado (§6.3, decisiones #5 y #7).

Despliegue hecho el 2026-07-22: schema re-aplicado en el VPS, `GUANTERA_API_SECRET`
generado en el VPS (secretos movidos por tubería SSH, nunca por la sesión), `N8N_URL`
y `N8N_API_KEY` en ambos `.env`, PM2 reiniciado con las 5 rutas, los 2 workflows de
n8n creados por API y ACTIVOS (`La Guantera - Sync diario Notion + n8n`, 07:00, ramas
en paralelo con continue-on-error; `La Guantera - Webhook colector Claude Code`,
passthrough del header — no almacena el secreto), colector local validado (60
memorias; re-corrida = todo omitido, dedup OK) y programado con Task Scheduler
(`GuanteraColectorClaude`, diario 07:30, log en `~/.la-guantera/colector.log`).
Verificado: `/salud` 200, `/buscar` 401 sin secreto y 200 con filtros y fuente citada
(incluida la fuente `claude_code`). Pendiente único: `NOTION_TOKEN` en el `.env` del
VPS cuando Charly comparta las páginas desde Notion — mientras tanto `/sync/notion`
responde 503 sin romper nada.

## No negociables (ver `docs/BRIEF.md`, sección 13)
- `git push` y `gh repo create` SIEMPRE requieren confirmación explícita de Charly antes
  de ejecutarse — nunca asumir autorización previa.
- Nunca entran secretos reales a la sesión — solo fixtures sintéticos, incluso para
  probar la ingesta de GitHub o el backfill.
- Escaneo de credenciales siempre con `grep -l` o `grep -q`, nunca `grep -n`.
- El bot de Telegram (consulta e ingesta manual) solo responde a chat_id autorizados —
  nunca abierto a cualquier usuario.
- Instalación lo más simple posible (`docs/BRIEF.md`, sección 12): README real + script
  de setup, validado instalando desde cero antes de dar la Fase 1 por terminada.

## Workflow establecido
brief → modo plan → TDD rojo→verde (Vitest) → demo → auditoría de git → publicar.

## Decisiones técnicas abiertas
Ver `docs/BRIEF.md`, sección 9 — resolver con Charly o preguntar explícitamente antes
de programar, no adivinar ni asumir la opción más simple sin confirmar.
