-- La Guantera: esquema para busqueda semantica con pgvector
-- Ejecutar en el mismo proyecto de Supabase que ya usa charly-prospecting.
-- Se aplica con `npm run setup` (scripts/setup.ts) - no hace falta copiar/pegar
-- en el editor SQL de Supabase. Es idempotente: correrlo dos veces no rompe nada.
-- Requiere la extension pgvector habilitada (Supabase la trae disponible por defecto).

create extension if not exists vector;

create table if not exists guantera_chunks (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (
    source_type in ('github', 'notion', 'n8n', 'telegram_manual', 'claude_code')
  ),
  source_id text not null,            -- ej: commit SHA, `repo:ruta` de archivo, id de nota
  source_url text,                    -- link directo a la fuente original, cuando exista
  content text not null,              -- contenido exacto del chunk, sin resumir
  content_hash text not null,         -- sha256 hex del contenido: evita re-embeber lo que no cambio
  chunk_index int not null default 0, -- posicion del chunk dentro de su documento
  embedding vector(1536),             -- dimension de OpenAI text-embedding-3-small (decision cerrada,
                                      -- ver docs/BRIEF.md seccion 7.3 y el plan de Fase 1)
  metadata jsonb default '{}'::jsonb, -- repo, autor, fecha, tags, etc. segun source_type
  created_at timestamptz not null default now()
);

-- Anti re-embedding / anti duplicados: una re-sincronizacion que trae el mismo
-- contenido del mismo origen no inserta (ni paga embeddings) dos veces.
create unique index if not exists guantera_chunks_dedup_idx
  on guantera_chunks (source_type, source_id, content_hash);

-- Indice HNSW con similitud coseno: recomendacion actual de Supabase para pgvector,
-- correcto para el volumen de datos de un proyecto personal (muy por debajo de 1M filas).
create index if not exists guantera_chunks_embedding_idx
  on guantera_chunks
  using hnsw (embedding vector_cosine_ops);

-- Indice de apoyo para filtrar/depurar por fuente sin tocar el indice vectorial
create index if not exists guantera_chunks_source_type_idx
  on guantera_chunks (source_type);

-- Busqueda semantica: top-N chunks por similitud coseno sobre el umbral dado.
-- Se invoca via supabase.rpc('guantera_buscar', ...) desde src/almacenamiento/supabase-client.ts.
create or replace function guantera_buscar(
  query_embedding vector(1536),
  limite int default 5,
  umbral float default 0.35
)
returns table (
  id uuid,
  content text,
  source_type text,
  source_id text,
  source_url text,
  metadata jsonb,
  similitud float
)
language sql stable
as $$
  select
    c.id,
    c.content,
    c.source_type,
    c.source_id,
    c.source_url,
    c.metadata,
    1 - (c.embedding <=> query_embedding) as similitud
  from guantera_chunks c
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) >= umbral
  order by c.embedding <=> query_embedding
  limit limite;
$$;

-- Nota Fase 2: si el volumen crece mucho, evaluar halfvec para reducir ~50% el
-- almacenamiento de los vectores con perdida minima de precision (pgvector 0.7+).
