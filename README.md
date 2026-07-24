# La Guantera

Memoria estructurada y consultable del ecosistema de Charly.marketing — GitHub, notas manuales por Telegram, páginas de Notion, workflows de n8n y memorias de Claude Code — con búsqueda por **significado** (embeddings), no por palabra clave.

Le preguntas al bot de Telegram en lenguaje natural ("¿dónde quedó la decisión del índice HNSW?") y responde con el **contenido exacto** del fragmento más relevante + su fuente citada (commit, archivo, nota). Nunca un resumen.

> Brief completo en [`docs/BRIEF.md`](./docs/BRIEF.md) — arquitectura, decisiones y fases.

**Estado:** en producción desde julio 2026 — corre como servicio PM2 en el VPS, con ingesta automática de eventos de GitHub vía n8n. Fase 2 (sync de Notion/n8n, memorias de Claude Code y API para otros agentes) implementada — ver la sección Fase 2.

## Stack

TypeScript + Node.js · Supabase/pgvector (HNSW) · OpenAI `text-embedding-3-small` (embeddings) y `gpt-4o-mini-transcribe` (voz) · grammY (bot de Telegram) · n8n (reenvío de webhooks de GitHub) · Vitest

## Requisitos

- **Node.js 20+** y npm
- **Cuenta de Supabase** (pgvector viene disponible por defecto)
- **API key de OpenAI** — se usa para embeddings y para transcribir notas de voz; con uso personal el costo es de centavos al mes
- **Bot de Telegram propio** creado vía [@BotFather](https://t.me/BotFather)
- **Personal access token de GitHub con permiso de LECTURA sobre los repos que quieras indexar** (en tokens fine-grained: `Contents: Read` y `Metadata: Read` sobre esos repos). Sin ese permiso el backfill no puede leer el historial.
- **n8n corriendo** (solo para la ingesta automática de eventos nuevos de GitHub; el backfill y el bot funcionan sin n8n)

## Instalación

Los pasos van en orden. Si algo falla, el mensaje de error dice qué falta.

> ¿No sabes de dónde sale alguna clave? [`docs/INSTALACION-CLAVES.md`](./docs/INSTALACION-CLAVES.md)
> documenta dónde se consigue cada una hoy, con los tropiezos reales del proyecto marcados.

### 1. Clonar e instalar dependencias

```bash
git clone <url-del-repo> la-guantera
cd la-guantera
npm install
```

### 2. Crear el bot en BotFather y conseguir tu chat_id

1. En Telegram, habla con [@BotFather](https://t.me/BotFather) → `/newbot` → sigue los pasos → copia el **token**.
2. Consigue tu **chat_id**: habla con [@userinfobot](https://t.me/userinfobot) (o cualquier bot equivalente) y copia el número que te devuelve.

El bot **solo responderá a los chat_id que autorices** en el paso siguiente — cualquier otro usuario es ignorado en silencio.

### 3. Llenar el `.env`

```bash
cp .env.example .env
```

Abre `.env` y llena cada variable (el archivo explica cada una):

| Variable | De dónde sale |
|---|---|
| `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API |
| `SUPABASE_DB_URL` | Supabase → Settings → Database → Connection string (URI). Solo la usa `npm run setup` |
| `OPENAI_API_KEY` | platform.openai.com → API keys |
| `TELEGRAM_BOT_TOKEN` | BotFather (paso 2) |
| `TELEGRAM_CHAT_IDS` | Tu chat_id (paso 2); varios van separados por coma |
| `GITHUB_TOKEN` | github.com → Settings → Developer settings → tokens. **Debe tener permiso de lectura sobre los repos de `GITHUB_REPOS`** |
| `GITHUB_WEBHOOK_SECRET` | Invéntalo tú (una cadena larga aleatoria); se repite igual en n8n en el paso 6 |
| `GITHUB_REPOS` | Los repos a indexar, formato `owner/repo`, separados por coma |

### 4. Aplicar el schema en Supabase

```bash
npm run setup
```

Valida que el `.env` esté completo y crea la tabla `guantera_chunks`, sus índices y la función de búsqueda `guantera_buscar`. Es idempotente: correrlo dos veces no rompe nada.

### 5. Backfill inicial (el historial que ya existe)

```bash
npm run backfill
```

Recorre **todo el historial de commits** de cada repo de `GITHUB_REPOS` más el snapshot actual de sus archivos (respetando el `.gitignore` de cada repo), pasa todo por el chequeo de secretos, y lo indexa. Sin este paso el bot solo sabría de eventos futuros.

Es re-ejecutable: una segunda corrida no paga embeddings ni duplica nada que no haya cambiado.

### 6. Conectar la ingesta de eventos nuevos vía n8n

En n8n, crea un workflow con dos nodos:

1. **GitHub Trigger** — eventos `push`, `pull_request`, `issues` de los mismos repos de `GITHUB_REPOS` (requiere permisos de owner/admin para registrar el webhook).
2. **HTTP Request** — método `POST`, URL `http://172.17.0.1:3013/ingesta/github` (el host/puerto donde corre La Guantera), body = JSON del evento (`{{ $json.body }}` según cómo entregue tu versión del nodo), y un header:
   - `X-Guantera-Secret`: el mismo valor de `GITHUB_WEBHOOK_SECRET` de tu `.env`.

Sin ese header (o con otro valor), La Guantera responde 401 y no procesa nada.

### 7. Arrancar el servicio

```bash
npm run dev                  # desarrollo (recarga al guardar, corre TypeScript directo)
npm run build && npm start   # produccion (compila a dist/ y corre node dist/index.js)
```

Arranca el bot de Telegram (long polling — no necesita URL pública) y el listener HTTP interno para n8n en `127.0.0.1:3013` (configurable con `HOST_HTTP`/`PUERTO_HTTP`; en el VPS usar `HOST_HTTP=172.17.0.1`, el mismo patrón de red que los demás agentes).

Para dejarlo corriendo en el VPS, el mismo patrón que los demás servicios (pm2/systemd): `npm run build` y luego `pm2 start npm --name la-guantera --time -- start`, seguido de `pm2 save`.

Verificación rápida tras el despliegue: `curl http://172.17.0.1:3013/salud` debe responder `{"ok":true}`, y un POST a `/ingesta/github` sin el header `X-Guantera-Secret` debe devolver 401.

## Uso

Habla con tu bot en Telegram (desde un chat_id autorizado):

- **Pregunta en texto libre**: `¿dónde quedó la decisión del índice HNSW?` → responde con el contenido exacto más relevante + fuente citada + hasta 2 fuentes alternativas.
- **Pregunta por voz**: mándale un audio — lo transcribe y busca igual.
- **/nota `<texto>`**: guarda una nota manual en la memoria.
- **Nota por voz**: audio que empiece con la palabra "nota" (ej. *"nota: el puerto de la guantera es 3013"*).
- **/start**: ayuda breve.

Todo lo que entra (notas, commits, archivos) pasa antes por un **chequeo de secretos**: si algo parece una credencial, se rechaza completo y el bot te avisa sin repetir el contenido.

## Tests

```bash
npm test
```

Suite de Vitest cubriendo cada módulo: chequeo de secretos, chunking, embeddings, almacenamiento, ingesta de GitHub, ingesta manual de Telegram, motor de consulta, bot (incluido el rechazo a chat_id no autorizados) y listener HTTP. Todos los fixtures son sintéticos: ningún secreto real toca los tests.

## Estructura

```
src/
├── ingesta/          github.ts, telegram-manual.ts, notion-n8n.ts, claude-code.ts
├── procesamiento/    chequeo-secretos.ts, chunking.ts, embeddings.ts
├── almacenamiento/   supabase-client.ts (guantera_chunks + RPC guantera_buscar)
├── consulta/         query-engine.ts, telegram-bot.ts, api.ts (POST /buscar)
├── pipeline.ts       secretos → chunking → embeddings → Supabase
├── config.ts         validación de entorno
└── index.ts          bot + listener HTTP
scripts/              schema.sql, setup.ts, backfill.ts, demo.ts, colector-claude.ts
```

## Fase 2 — más fuentes y acceso multi-agente

Todo corre dentro del mismo servicio y puerto (3013). Los pasos de esta sección son
opcionales e independientes entre sí: cada fuente que no configures simplemente responde
503 con un mensaje que dice qué variable falta.

> Si vienes de Fase 1: vuelve a correr `npm run setup` (actualiza la función
> `guantera_buscar` con filtros por fuente y fecha) y agrega `GUANTERA_API_SECRET`
> a tu `.env` antes de reiniciar el servicio.

### API de consulta para otros agentes (`POST /buscar`)

Cualquier agente del stack puede consultar La Guantera por HTTP dentro del VPS,
autenticándose con el header `X-Guantera-Api-Secret` (variable `GUANTERA_API_SECRET`,
distinta del secreto de ingesta):

```bash
curl -s http://172.17.0.1:3013/buscar \
  -H 'content-type: application/json' \
  -H 'x-guantera-api-secret: <GUANTERA_API_SECRET>' \
  -d '{
    "pregunta": "¿dónde quedó la decisión del índice HNSW?",
    "fuentes": ["github", "notion"],
    "desde": "2026-06-01T00:00:00Z",
    "limite": 5
  }'
```

Respuesta: `{ "encontrado": true, "resultados": [{ "contenido", "sourceType", "sourceId", "sourceUrl", "metadata", "similitud" }] }` — contenido exacto + fuente citada, igual que el bot. `fuentes`, `desde`, `hasta`, `limite` y `umbral` son opcionales.

### Sync periódico de Notion y n8n

1. **Notion**: crea una integración interna en [notion.so/my-integrations](https://www.notion.so/my-integrations), copia el token a `NOTION_TOKEN`, y comparte con la integración las páginas que quieras indexar (ese es todo el control de alcance).
2. **n8n**: crea una API key (Settings → API) y llena `N8N_URL` (raíz de tu instancia) y `N8N_API_KEY`. Se indexa la definición de cada workflow (nombre, estado, etiquetas, nodos), no las ejecuciones.
3. En n8n, crea un workflow con un **Schedule Trigger** (diario está bien) y dos nodos **HTTP Request** en paralelo (ambos colgando del trigger, con "On Error: Continue"): `POST http://172.17.0.1:3013/sync/notion` y `POST http://172.17.0.1:3013/sync/n8n`, ambos con el header `X-Guantera-Secret` = `GITHUB_WEBHOOK_SECRET`. En paralelo y con continue-on-error para que un 503 de una fuente sin configurar no bloquee a la otra.

Cada corrida es un listado completo de la fuente: la primera trae todo lo que ya existe, las siguientes omiten lo que no cambió (sin pagar embeddings), reemplazan lo editado y borran de la memoria lo que ya no existe en la fuente. La respuesta lo resume: `{ "procesados", "omitidos", "rechazados", "borrados" }`.

### Ingesta de memorias de Claude Code (colector local)

Las memorias nativas de Claude Code (`~/.claude/projects/<workspace>/memory/*.md`, las
mismas que muestra el grafo de Memoria de Motor Agéntico 2.0) se recolectan en tu máquina
local y viajan al VPS vía n8n:

1. En n8n, crea un workflow con un nodo **Webhook** (método POST, path `guantera-claude`) y un **HTTP Request** que reenvíe el body tal cual a `POST http://172.17.0.1:3013/ingesta/claude-code`, conservando el header `X-Guantera-Secret` (o agregándolo con el valor de `GITHUB_WEBHOOK_SECRET`).
2. En tu máquina local, clona este repo, `npm install`, y en el `.env` llena solo `GUANTERA_WEBHOOK_URL` (la URL pública del webhook del paso 1) y `GUANTERA_WEBHOOK_SECRET` (el mismo secreto).
3. Pruébalo una vez a mano: `npx tsx scripts/colector-claude.ts` — imprime cuántas memorias encontró y el resumen del servidor.
4. Prográmalo diario con el Task Scheduler de Windows. Un `.cmd` intermedio aguanta
   rutas con espacios y deja log acumulado:

```bat
:: %USERPROFILE%\.la-guantera\colector-task.cmd
@echo off
cd /d "C:\ruta\a\la-guantera"
npx tsx scripts\colector-claude.ts >> "%USERPROFILE%\.la-guantera\colector.log" 2>&1
```

```powershell
schtasks /create /tn "GuanteraColectorClaude" /sc daily /st 07:30 /tr "%USERPROFILE%\.la-guantera\colector-task.cmd"
```

El colector manda el contenido completo de cada memoria más un manifiesto de las
vigentes: las memorias que borres localmente se borran también de `guantera_chunks`.
