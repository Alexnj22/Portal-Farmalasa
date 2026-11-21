-- Cierra dos huecos de alcance encontrados en la auditoría del 2026-11-21.
--
-- 1) `inventory_grouped` e `inventory_proximos_count` son SECURITY DEFINER y no
--    chequeaban ningún permiso: cualquier sesión `authenticated` leía el
--    inventario de las 7 sucursales, saltándose la policy `inventory_select`.
--    Ahora exigen lo mismo que esa policy (alguno de sus 13 módulos con can_view).
-- 2) `rebajas_en_ventas` filtraba `p_branch_id` sin mirar el alcance. Si el
--    alcance de Promociones no es ALL, se fuerza la sucursal propia (y sin
--    sucursal propia, no hay datos).
--
-- Los cuerpos se reescriben partiendo de la definición VIVA
-- (pg_get_functiondef), insertando la guarda justo después del primer BEGIN:
-- así no se pisa nada que otra sesión haya cambiado. Idempotente.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.auth_puede_ver_inventario()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM unnest(ARRAY['inventario','dash_inv_search','dash_inv_movement','traslados',
      'dash_traslados','conteo_inventario','minmax','dash_minmax_req','pedidos','gestion_stock',
      'ventas','sync_health','requests']) m(m)
    WHERE public.auth_has_module_permission(m.m, 'can_view'));
$$;
REVOKE EXECUTE ON FUNCTION public.auth_puede_ver_inventario() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_puede_ver_inventario() TO authenticated, service_role;

DO $do$
DECLARE
  v_def text;
  v_guarda_inv constant text := E'\nBEGIN\n  -- Guarda de permiso (2026-11-21): la misma regla que la policy inventory_select.\n  IF NOT (SELECT public.auth_puede_ver_inventario()) THEN\n    RAISE EXCEPTION ''Sin permiso para ver el inventario.'' USING ERRCODE = ''42501'';\n  END IF;\n';
  v_guarda_reb constant text := E'\nBEGIN\n  -- Alcance (2026-11-21): con alcance de sala sólo se ve la sucursal propia.\n  IF (SELECT public.auth_module_scope(''promociones'')) IS DISTINCT FROM ''ALL'' THEN\n    p_branch_id := (SELECT public.auth_employee_branch_id());\n    IF p_branch_id IS NULL THEN\n      RAISE EXCEPTION ''Sin sucursal asignada.'' USING ERRCODE = ''42501'';\n    END IF;\n  END IF;\n';
  f record;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('inventory_grouped', 'inventory_proximos_count', 'rebajas_en_ventas')
  LOOP
    v_def := pg_get_functiondef(f.oid);
    IF position('Guarda de permiso (2026-11-21)' IN v_def) > 0
       OR position('Alcance (2026-11-21)' IN v_def) > 0 THEN
      CONTINUE;
    END IF;
    IF position(E'\nBEGIN\n' IN v_def) = 0 THEN
      RAISE EXCEPTION 'No encontré el BEGIN de %', f.proname;
    END IF;
    v_def := overlay(v_def PLACING CASE WHEN f.proname = 'rebajas_en_ventas' THEN v_guarda_reb ELSE v_guarda_inv END
                     FROM position(E'\nBEGIN\n' IN v_def) FOR length(E'\nBEGIN\n'));
    EXECUTE v_def;
  END LOOP;
END
$do$;
