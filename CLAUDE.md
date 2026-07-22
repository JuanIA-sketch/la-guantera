# La Guantera — Contexto para Claude Code

Antes de cualquier tarea, lee `docs/BRIEF.md` completo — es la fuente de verdad del
proyecto (arquitectura, fuentes de ingesta, pipeline, fases, decisiones abiertas).
Revisa también los archivos stub en `src/` (cada uno documenta su propia responsabilidad
y sus pendientes) y `scripts/schema.sql`.

## Estado actual
**Fase 1 completa, validada y en producción** (julio 2026). Implementada con TDD
rojo→verde (Vitest, 94 tests), instalación validada por Charly desde cero con claves
reales, historia de git auditada (cero secretos en todos los blobs) y repo público en
`JuanIA-sketch/la-guantera`.

Producción: VPS de Hostinger, proceso PM2 (`la-guantera`, `npm run build` + `node
dist/index.js`), puerto 3013 expuesto solo en 172.17.0.1, workflow de n8n (GitHub
Trigger → HTTP Request con header `X-Guantera-Secret`) conectado y probado de punta a
punta con un commit real. Ajustes de despliegue ya commiteados: supabase-js fijado en
2.109.0 y transport `ws` explícito, ambos por el Node 20 del VPS.
Pendiente menor: README y `.env.example` documentan puerto 3012 — alinear con el 3013
real al retomar.

**Fase 2 pendiente de planear.** Alcance: sync periódico de n8n/Notion, API HTTP
interna para otros agentes, e ingesta de Claude Code vía la **Memoria nativa de Motor
Agentico 2.0** — ya NO vía El Cosechador, que no existe en esa versión (esto reemplaza
la decisión #5 y la sección 6.3 del brief, que aún mencionan El Cosechador).

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
