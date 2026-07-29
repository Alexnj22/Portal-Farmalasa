SET lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- unaccent(text) no es IMMUTABLE (depende del search_path para el diccionario).
-- Wrapper con diccionario explícito → indexable.
CREATE OR REPLACE FUNCTION public.f_unaccent(text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
SET search_path = ''
AS $$ SELECT extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

-- Espejo EXACTO de normSearch() en src/utils/searchUtils.js.
-- Si se cambia el char class aquí, cambiarlo también en JS (y viceversa).
CREATE OR REPLACE FUNCTION public.norm_search(text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT trim(lower(regexp_replace(
    public.f_unaccent(coalesce($1, '')),
    '[.\-/,;:()''"’]', '', 'g'
  )))
$$;

REVOKE EXECUTE ON FUNCTION public.f_unaccent(text), public.norm_search(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.f_unaccent(text), public.norm_search(text) TO authenticated, service_role;
