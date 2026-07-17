-- La Guantera: esquema inicial para busqueda semantica con pgvector
-- Ejecutar en el mismo proyecto de Supabase que ya usa charly-prospecting.
-- Requiere la extension pgvector habilitada (Supabase la trae disponible por defecto).

create extension if not exists vector;

create table if not exists guantera_chunks (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (
    source_type in ('github', 'notion', 'n8n', 'telegram_manual', 'claude_code')
  ),
  source_id text not null,            -- ej: commit SHA, page_id de Notion, workflow_id de n8n
  source_url text,                    -- link directo a la fuente original, cuando exista
  content text not null,              -- contenido exacto del chunk, sin resumir
  embedding vector(1536),             -- 1536 = dimension de OpenAI text-embedding-3-small.
                                       -- AJUSTAR si en modo plan se elige otro proveedor (seccion 7.3 del brief).
  metadata jsonb default '{}'::jsonb, -- repo, autor, fecha, tags, etc. segun source_type
  created_at timestamptz not null default now()
);

-- Indice HNSW con similitud coseno: recomendacion actual de Supabase para pgvector,
-- correcto para el volumen de datos de un proyecto personal (muy por debajo de 1M filas).
create index if not exists guantera_chunks_embedding_idx
  on guantera_chunks
  using hnsw (embedding vector_cosine_ops);

-- Indice de apoyo para filtrar/depurar por fuente sin tocar el indice vectorial
create index if not exists guantera_chunks_source_type_idx
  on guantera_chunks (source_type);

-- Nota Fase 2: si el volumen crece mucho, evaluar halfvec para reducir ~50% el
-- almacenamiento de los vectores con perdida minima de precision (pgvector 0.7+).
