-- El catálogo de actividades económicas de Hacienda (CAT-019) en la base, y el
-- giro validado contra él al crear y al corregir un cliente (2026-11-15).
--
-- Los 774 renglones son los de src/data/actividadesMH.js («Catálogo actualizado
-- del Sistema de Facturación v1.2», factura.gob.sv). NO van en esta migración
-- (son 50 kB): los siembra `barrido-clientes-caja` con {"modo":"sembrar_giros"},
-- desde su copia generada `_shared/actividadesMH.ts`. Con la tabla VACÍA (el
-- branch de pruebas recién hecho) `giro_valido` deja pasar: un catálogo que no
-- está no puede rechazar a nadie. El giro de la ficha guarda
-- el TEXTO de la actividad; se compara sin tildes, mayúsculas ni espacios de
-- más (`giro_clave`): medido hoy, los 51 giros distintos de las fichas reales
-- están en el catálogo con esa comparación.
--
-- Como el NIT: siempre al crear, y al corregir sólo si el giro cambió.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.actividades_economicas (
  codigo      text PRIMARY KEY,
  descripcion text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.actividades_economicas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS actividades_economicas_select ON public.actividades_economicas;
CREATE POLICY actividades_economicas_select ON public.actividades_economicas
  FOR SELECT TO authenticated USING (true);

-- Sin `SET search_path` a propósito: sólo usa funciones del sistema y así se
-- inlinea en el índice y en `giro_valido`.
CREATE OR REPLACE FUNCTION public.giro_clave(p text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $f$ SELECT lower(regexp_replace(btrim(translate(coalesce(p, ''),
  'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g')) $f$;

REVOKE EXECUTE ON FUNCTION public.giro_clave(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.giro_clave(text) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS actividades_economicas_clave_idx
  ON public.actividades_economicas (public.giro_clave(descripcion));

CREATE OR REPLACE FUNCTION public.giro_valido(p_giro text)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public, extensions
AS $f$ SELECT nullif(btrim(coalesce(p_giro, '')), '') IS NULL
   OR NOT EXISTS (SELECT 1 FROM public.actividades_economicas)
   OR EXISTS (SELECT 1 FROM public.actividades_economicas a
               WHERE public.giro_clave(a.descripcion) = public.giro_clave(p_giro)) $f$;
REVOKE EXECUTE ON FUNCTION public.giro_valido(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.giro_valido(text) TO authenticated, service_role;

DO $do$
DECLARE
  v_def text;
  v_ancla text;
BEGIN
  v_def := pg_get_functiondef('public.cliente_crear(jsonb)'::regprocedure);
  v_ancla := '  -- ── ¿Ya existe? DUI, NIT y la clave sin tildes, en ese orden.';
  IF position('GIRO_INVALIDO' IN v_def) > 0 THEN
    RAISE NOTICE 'cliente_crear ya valida el giro';
  ELSIF position(v_ancla IN v_def) = 0 THEN
    RAISE NOTICE 'cliente_crear: no está el ancla, no se toca';
  ELSE
    EXECUTE replace(v_def, v_ancla,
      E'  -- Giro: del catálogo de Hacienda (giro_valido).\n'
      || E'  IF NOT public.giro_valido(v ->> ''giro'') THEN RAISE EXCEPTION ''GIRO_INVALIDO''; END IF;\n\n'
      || v_ancla);
  END IF;

  v_def := pg_get_functiondef('public.update_customer_fiscal(bigint,jsonb,boolean)'::regprocedure);
  v_ancla := '  -- Los datos de un contribuyente se declaran a Hacienda.';
  IF position('GIRO_INVALIDO' IN v_def) > 0 THEN
    RAISE NOTICE 'update_customer_fiscal ya valida el giro';
  ELSIF position(v_ancla IN v_def) = 0 THEN
    RAISE NOTICE 'update_customer_fiscal: no está el ancla, no se toca';
  ELSE
    EXECUTE replace(v_def, v_ancla,
      E'  IF (v_new ->> ''giro'') IS DISTINCT FROM (v_old ->> ''giro'')\n'
      || E'     AND NOT public.giro_valido(v_new ->> ''giro'') THEN\n'
      || E'    RAISE EXCEPTION ''GIRO_INVALIDO'';\n'
      || E'  END IF;\n\n'
      || v_ancla);
  END IF;
END
$do$;
