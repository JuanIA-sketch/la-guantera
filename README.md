# La Guantera

Memoria estructurada y consultable del ecosistema de Charly.marketing — GitHub, notas manuales por Telegram, y en Fase 2 n8n/Notion y Claude Code — con búsqueda por **significado** (embeddings), no por palabra clave.

Le preguntas al bot de Telegram en lenguaje natural ("¿dónde quedó la decisión del índice HNSW?") y responde con el **contenido exacto** del fragmento más relevante + su fuente citada (commit, archivo, nota). Nunca un resumen.

> Brief completo en [`docs/BRIEF.md`](./docs/BRIEF.md) — arquitectura, decisiones y fases.

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
2. **HTTP Request** — método `POST`, URL `http://172.17.0.1:3012/ingesta/github` (el host/puerto donde corre La Guantera), body = JSON del evento (`{{ $json.body }}` según cómo entregue tu versión del nodo), y un header:
   - `X-Guantera-Secret`: el mismo valor de `GITHUB_WEBHOOK_SECRET` de tu `.env`.

Sin ese header (o con otro valor), La Guantera responde 401 y no procesa nada.

### 7. Arrancar el servicio

```bash
npm run dev      # desarrollo (recarga al guardar)
npm start        # produccion
```

Arranca el bot de Telegram (long polling — no necesita URL pública) y el listener HTTP interno para n8n en `127.0.0.1:3012` (configurable con `HOST_HTTP`/`PUERTO_HTTP`; en el VPS usar `HOST_HTTP=172.17.0.1`, el mismo patrón de red que los demás agentes).

Para dejarlo corriendo en el VPS, el mismo patrón que los demás servicios (pm2/systemd), por ejemplo: `pm2 start npm --name la-guantera -- start`.

## Uso

Habla con tu bot en Telegram (desde un chat_id autorizado):

- **Pregunta en texto libre**: `¿dónde quedó la decisión del índice HNSW?` → responde con el contenido exacto más relevante + fuente citada + hasta 2 fuentes alternativas.
- **Pregunta por voz**: mándale un audio — lo transcribe y busca igual.
- **/nota `<texto>`**: guarda una nota manual en la memoria.
- **Nota por voz**: audio que empiece con la palabra "nota" (ej. *"nota: el puerto de la guantera es 3012"*).
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
├── ingesta/          github.ts (backfill + eventos de n8n), telegram-manual.ts
├── procesamiento/    chequeo-secretos.ts, chunking.ts, embeddings.ts
├── almacenamiento/   supabase-client.ts (guantera_chunks + RPC guantera_buscar)
├── consulta/         query-engine.ts, telegram-bot.ts, api.ts (Fase 2)
├── pipeline.ts       secretos → chunking → embeddings → Supabase
├── config.ts         validación de entorno
└── index.ts          bot + listener HTTP
scripts/              schema.sql, setup.ts, backfill.ts
```

## Fase 2 (pendiente)

Sync periódico de n8n/Notion, ingesta de Claude Code vía El Cosechador, API HTTP interna para otros agentes del stack, filtros por fuente y fecha. Ver `docs/BRIEF.md`, sección 10.
