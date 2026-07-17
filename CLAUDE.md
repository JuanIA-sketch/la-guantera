# La Guantera — Contexto para Claude Code

Antes de cualquier tarea, lee `docs/BRIEF.md` completo — es la fuente de verdad del
proyecto (arquitectura, fuentes de ingesta, pipeline, fases, decisiones abiertas).
Revisa también los archivos stub en `src/` (cada uno documenta su propia responsabilidad
y sus pendientes) y `scripts/schema.sql`.

## Estado actual
Fase 1 implementada (TDD rojo→verde, Vitest). Decisiones de la sección 9 resueltas con
Charly en modo plan: OpenAI text-embedding-3-small (1536 dims) + gpt-4o-mini-transcribe,
bot de Telegram dedicado, repos activos de julio, backfill de todo el historial,
detalle híbrido de GitHub (commits + snapshot de código respetando .gitignore).
Pendiente: validación de instalación desde cero siguiendo solo el README (la ejecuta
Charly con claves reales, fuera de la sesión) y las decisiones #5 y #7 (Fase 2).

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
