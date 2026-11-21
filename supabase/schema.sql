-- ============================================================================
-- Liga Master Argentina PES6 — Esquema SQL para Supabase (PostgreSQL + Storage)
-- ============================================================================
-- Instrucciones:
-- 1. Abrí el SQL Editor de tu proyecto en Supabase (https://supabase.com/dashboard).
-- 2. Pegá y ejecutá este archivo completo (Run).
-- 3. Creará:
--    - La tabla `public.league_store` protegida con Row Level Security (RLS).
--    - El bucket público de Storage `lma-uploads` para escudos, fotos, videos y MP3.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.league_store (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Habilitamos RLS sin políticas públicas:
-- Ningún navegador (clave anon / publishable) puede leer hashes ni datos internos directamente.
-- Únicamente el servidor backend (Express / Vercel Functions con SUPABASE_SERVICE_ROLE_KEY) accede a la tabla.
ALTER TABLE public.league_store ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.league_store FROM anon, authenticated;

-- Crear bucket público para archivos subidos (escudos, capturas, festejos, noticias, MP3, videos)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('lma-uploads', 'lma-uploads', true, 104857600)
ON CONFLICT (id) DO UPDATE
SET public = true;

-- Permitir lectura pública (GET) de los archivos del bucket `lma-uploads`
-- (Las subidas, ediciones y borrados siguen restringidos al servidor con service_role)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read access for lma-uploads'
  ) THEN
    CREATE POLICY "Public read access for lma-uploads"
      ON storage.objects
      FOR SELECT
      TO public
      USING (bucket_id = 'lma-uploads');
  END IF;
END
$$;
