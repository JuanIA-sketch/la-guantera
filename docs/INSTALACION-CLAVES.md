# La Guantera — De dónde sale cada clave (julio 2026)

Guía de credenciales para instalar La Guantera, basada en la instalación real del
proyecto (Fase 1 validada desde cero y despliegue de Fase 2), con los tropiezos
reales marcados. Los pasos completos de instalación están en el
[README](../README.md); esto cubre solo el "¿y esta clave de dónde la saco?".

Orden recomendado: consíguelas todas antes de tocar el `.env`. Ninguna clave real
debe entrar jamás a una sesión de Claude Code — se pegan directo en el `.env` con
tu editor.

## 1. Supabase — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`

- **Dónde hoy:** en tu proyecto de Supabase → **Settings → API** (la URL del
  proyecto y la key **service_role** — no la `anon`, que no puede escribir en la
  tabla). `SUPABASE_DB_URL` sale de **Settings → Database → Connection string (URI)**.
- **Nota:** `SUPABASE_DB_URL` solo la usa `npm run setup` para aplicar el schema; el
  servicio no la necesita para correr. Sirve reutilizar un proyecto Supabase
  existente: La Guantera solo crea su propia tabla (`guantera_chunks`).

## 2. Embeddings — `OPENAI_API_KEY`

- **Dónde hoy:** [platform.openai.com](https://platform.openai.com) → **API keys**.
  La misma key cubre embeddings (`text-embedding-3-small`) y transcripción de voz.
- **Tropiezo real:** intentamos evitar una cuenta nueva reutilizando la suscripción
  de OpenCode Go (GLM/DeepSeek) — **no se puede**: ese endpoint solo expone
  chat/completions, no embeddings. Necesitas proveedor de embeddings aparte; con uso
  personal son centavos al mes.

## 3. Telegram — `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS`

- **Dónde hoy:** el token te lo da [@BotFather](https://t.me/BotFather) con
  `/newbot`; tu chat_id te lo da [@userinfobot](https://t.me/userinfobot). El bot
  ignora cualquier chat_id que no esté en la lista — es el control de acceso, no lo
  dejes vacío "para probar".

## 4. GitHub — `GITHUB_TOKEN`

- **Dónde hoy:** github.com → **Settings → Developer settings → Fine-grained
  tokens**, con permisos **Contents: Read** y **Metadata: Read** sobre los repos a
  indexar.
- **Tropiezo real:** sin esos permisos el bot "funciona" pero el backfill no puede
  leer el historial — y el valor del proyecto está justo en el historial viejo.

## 5. `GITHUB_WEBHOOK_SECRET` — el secreto de ingesta

- **Dónde hoy:** **en ningún panel — se inventa** (una cadena larga aleatoria, ej.
  `openssl rand -hex 32`). Vive en el `.env` del servidor y se repite en el header
  `X-Guantera-Secret` de los nodos HTTP Request de n8n.
- **Cambió de rol durante el proyecto:** nació como "el secreto del webhook de
  GitHub" (Fase 1), pero en Fase 2 pasó a ser **el secreto único de toda la ingesta
  n8n↔Guantera**: `/ingesta/github`, `/ingesta/claude-code`, `/sync/notion` y
  `/sync/n8n` validan todos contra él. El nombre de la variable quedó por historia;
  no te confunda: no sale de GitHub.

## 6. `GUANTERA_WEBHOOK_SECRET` — el del colector local

- **Dónde hoy:** tampoco se consigue — es **el mismo valor** que
  `GITHUB_WEBHOOK_SECRET` del servidor, copiado al `.env` de la máquina donde corre
  el colector de memorias de Claude Code.
- **Tropiezo real (nos pasó):** el valor solo existía en el `.env` del VPS y la
  variable local quedó vacía. Síntoma exacto: el colector muere con `Faltan
  variables de entorno del colector`. Si ves eso, revisa que copiaste el valor a la
  máquina local — no generes uno nuevo, porque el servidor no lo va a aceptar (401).

## 7. `GUANTERA_API_SECRET` — la API para otros agentes (Fase 2)

- **Dónde hoy:** se genera, no se consigue (`openssl rand -hex 32`). Es **distinto a
  propósito** del secreto de ingesta: uno autoriza escribir, el otro consultar
  (`POST /buscar`, header `X-Guantera-Api-Secret`).

## 8. n8n — `N8N_URL`, `N8N_API_KEY` (Fase 2)

- **Dónde hoy:** en tu instancia de n8n → **Settings → n8n API → Create API key**.
  `N8N_URL` es la raíz de la instancia (sin `/api/v1`).
- **Cambió de nombre durante el proyecto:** el `.env.example` de Fase 1 decía
  `N8N_BASE_URL` — en Fase 2 quedó **`N8N_URL`**. Si copiaste un `.env` viejo, el
  sync responde 503 y el mensaje te dice qué variable espera.

## 9. Notion — `NOTION_TOKEN` (Fase 2, opcional)

- **Dónde hoy:** [notion.so/my-integrations](https://www.notion.so/my-integrations)
  → **New integration** (interna) → copia el **Internal Integration Secret**.
  Después, **comparte con la integración cada página que quieras indexar** (menú
  `···` → Connections) — ese es todo el control de alcance; sin compartir, el token
  existe pero no ve nada.
- **Cambió de nombre durante el proyecto:** era `NOTION_API_KEY` en el
  `.env.example` de Fase 1; en Fase 2 quedó **`NOTION_TOKEN`**. Y sin la variable,
  `/sync/notion` responde 503 con mensaje claro — no rompe el resto.

## 10. VPS / SSH

- **Dónde hoy:** cualquier VPS con Node 20+ sirve; nosotros usamos uno de Hostinger
  ya existente. El acceso es `ssh root@<IP>` con llave (la llave pública se carga
  desde el panel del proveedor). El servicio se ata a `172.17.0.1:3013` — **nunca a
  una IP pública**; todo lo externo entra por n8n.

---

Dos aclaraciones finales: las rutas de consola de Supabase/OpenAI/GitHub/Notion son
las que usamos en la instalación real de julio 2026 — si algún dashboard reacomoda
menús, los nombres a buscar son los que están en negrita. Y los dos renombres de
variables (#8 y #9) existen porque los stubs de Fase 1 se escribieron antes de
implementar; el `.env.example` actual del repo ya trae los nombres correctos.
