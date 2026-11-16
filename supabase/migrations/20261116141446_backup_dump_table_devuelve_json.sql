-- El respaldo semanal del 2026-11-15 murió con «Memory limit exceeded» en
-- audit_logs (57.5k filas, ~10k nuevas por semana). jsonb_agg arma el valor
-- binario entero; con RETURNS json la edge function puede pasar el texto de la
-- respuesta directo al gzip sin parsearlo (patrón C de CLAUDE.md).
-- Misma whitelist que antes: es la misma lista que TABLES en
-- supabase/functions/backup-critical-tables/index.ts.
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.backup_dump_table(text);

CREATE FUNCTION public.backup_dump_table(p_table text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE result json;
BEGIN
  IF p_table <> ALL(ARRAY[
    'employees','roles','role_permissions','branches','shifts','holidays',
    'employee_branches','employee_events','employee_documents','employee_rosters',
    'product_stock_params','dispatch_rules','stock_config','minmax_ignored',
    'product_categories','erp_sucursal_map',
    'kiosk_devices','overtime_bank','payroll_periods','payroll_entries',
    'vacation_plan_headers','vacation_plans','audit_logs',
    -- Bitácoras (RTS 6.2.16: 2 años; Guía BPAD 3.12: 1 año)
    'bitacora_areas','bitacora_lecturas','bitacora_limpiezas',
    'bitacora_correcciones','bitacora_cierres','bitacora_dispensaciones',
    'bitacora_folios','bitacora_limpiezas_historial',
    -- La receta: la otra mitad del renglón (Guía 3.5 y 3.12)
    'recetas','receta_items','medicos','dispensacion_clases',
    -- Inyecciones: la bitácora que se cruza contra las ventas de inyectables
    'inyeccion_aplicaciones', 'inyeccion_libro',
    -- Lo que nació después del 3-sep (auditoría del 2026-11-13)
    'cumplimiento_registros', 'regencia_visitas', 'libro_lote_revisiones',
    'antibioticos_aware', 'antibioticos_producto'
  ]) THEN
    RAISE EXCEPTION 'TABLE_NOT_ALLOWED: %', p_table;
  END IF;
  EXECUTE format('SELECT COALESCE(json_agg(to_json(t)), ''[]''::json) FROM %I t', p_table) INTO result;
  RETURN result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.backup_dump_table(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backup_dump_table(text) TO service_role;
