-- NIT con dígito verificador al crear y al corregir un cliente, y el permiso
-- del widget «Clientes» del Inicio (2026-11-15).
--
-- `es_nit_valido`: vacío vale; 9 dígitos = el DUI usado como NIT (su propio
-- verificador); 14 = el verificador de Hacienda. Medido contra los 60 NIT de
-- 14 dígitos de las fichas reales: pasan los 60. Es el gemelo de
-- `nit14Verifica` en src/utils/clienteValidacion.js.
--
-- Las dos funciones se parchean desde su definición VIVA (pg_get_functiondef +
-- replace), no desde un borrador: así no se pisa nada que otra sesión les haya
-- cambiado. Si el ancla no está, se avisa y no se toca (y el branch de pruebas
-- no se rompe).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.es_nit_valido(p_nit text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  d text := regexp_replace(coalesce(p_nit, ''), '\D', '', 'g');
  s int := 0;
  dv int;
  w int[] := ARRAY[2, 7, 6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
BEGIN
  IF d = '' THEN RETURN true; END IF;
  IF length(d) = 9 THEN RETURN public.es_dui_valido(d); END IF;
  IF length(d) <> 14 THEN RETURN false; END IF;
  IF substr(d, 11, 3)::int <= 100 THEN
    FOR i IN 1..13 LOOP s := s + substr(d, i, 1)::int * (15 - i); END LOOP;
    dv := s % 11;
    IF dv = 10 THEN dv := 0; END IF;
  ELSE
    FOR i IN 1..13 LOOP s := s + substr(d, i, 1)::int * w[i]; END LOOP;
    dv := 11 - (s % 11);
    IF dv >= 10 THEN dv := 0; END IF;
  END IF;
  RETURN dv = substr(d, 14, 1)::int;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.es_nit_valido(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.es_nit_valido(text) TO authenticated, service_role;

DO $do$
DECLARE
  v_def text;
  v_ancla text;
BEGIN
  -- Al crear: siempre.
  v_def := pg_get_functiondef('public.cliente_crear(jsonb)'::regprocedure);
  v_ancla := '  -- ── ¿Ya existe? DUI, NIT y la clave sin tildes, en ese orden.';
  IF position('NIT_INVALIDO' IN v_def) > 0 THEN
    RAISE NOTICE 'cliente_crear ya valida el NIT';
  ELSIF position(v_ancla IN v_def) = 0 THEN
    RAISE NOTICE 'cliente_crear: no está el ancla, no se toca';
  ELSE
    EXECUTE replace(v_def, v_ancla,
      E'  -- NIT: su dígito verificador (es_nit_valido).\n'
      || E'  IF NOT public.es_nit_valido(v ->> ''nit'') THEN RAISE EXCEPTION ''NIT_INVALIDO''; END IF;\n\n'
      || v_ancla);
  END IF;

  -- Al corregir: sólo si el NIT cambió (como el DUI: lo heredado no congela la ficha).
  v_def := pg_get_functiondef('public.update_customer_fiscal(bigint,jsonb,boolean)'::regprocedure);
  v_ancla := '  -- Los datos de un contribuyente se declaran a Hacienda.';
  IF position('NIT_INVALIDO' IN v_def) > 0 THEN
    RAISE NOTICE 'update_customer_fiscal ya valida el NIT';
  ELSIF position(v_ancla IN v_def) = 0 THEN
    RAISE NOTICE 'update_customer_fiscal: no está el ancla, no se toca';
  ELSE
    EXECUTE replace(v_def, v_ancla,
      E'  IF (v_new ->> ''nit'') IS DISTINCT FROM (v_old ->> ''nit'')\n'
      || E'     AND NOT public.es_nit_valido(v_new ->> ''nit'') THEN\n'
      || E'    RAISE EXCEPTION ''NIT_INVALIDO'';\n'
      || E'  END IF;\n\n'
      || v_ancla);
  END IF;
END
$do$;

-- El widget «Clientes» del Inicio: activo para quien ve Clientes, como
-- `clientes_crear` (decisión del usuario, 2026-11-15).
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'dash_clientes', true, false, false, 'ALL'
  FROM public.role_permissions rp
 WHERE rp.module_key = 'clientes' AND rp.can_view
ON CONFLICT (role_id, module_key) DO NOTHING;
