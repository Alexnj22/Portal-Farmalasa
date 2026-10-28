SET lock_timeout = '5s';
-- La lista de `backup_dump_table` y la de `backup-critical-tables` son la MISMA
-- lista dicha dos veces (ver la función). Se agrega `inyeccion_aplicaciones`:
-- la bitácora de inyecciones no estaba en el respaldo semanal (auditoría de
-- bitácoras del 2026-10-28). Primero la base, después la función: al revés,
-- la función pide una tabla que la base rechaza y el respaldo ENTERO sale ok:false.
CREATE OR REPLACE FUNCTION public.backup_dump_table(p_table text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE result jsonb;
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
    'inyeccion_aplicaciones'
  ]) THEN
    RAISE EXCEPTION 'TABLE_NOT_ALLOWED: %', p_table;
  END IF;
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM %I t', p_table) INTO result;
  RETURN result;
END;
$function$;
