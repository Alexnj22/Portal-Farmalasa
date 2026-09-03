SET lock_timeout = '5s';

-- El respaldo semanal ya alcanzaba las 8 tablas `bitacora_*`, pero no la
-- RECETA: `recetas`, `receta_items` y `medicos` quedaban afuera. O sea que
-- guardaba exactamente la mitad del renglón que se puede reconstruir del ERP
-- —producto, lote, cantidad, vencimiento— y dejaba fuera la que no: el
-- paciente, el prescriptor y la URL de la foto. Que es, palabra por palabra, lo
-- que piden los ítems 3.5 y 3.12 de la Guía de Verificación de BPAD.
--
-- `dispensacion_clases` entra también: sin ella no se sabe POR QUÉ un producto
-- estaba en un libro y no en el otro, y ese motivo escrito es la respuesta a la
-- pregunta del inspector.
--
-- ⚠️ Esta lista y la constante `TABLES` de `supabase/functions/backup-critical-
-- tables/index.ts` son la MISMA lista dicha dos veces, y se mueven juntas. Una
-- tabla agregada sólo allá vuelve `TABLE_NOT_ALLOWED`, y como el contador de
-- fallos hace que la corrida entera reporte `ok: false`, se cae el respaldo
-- COMPLETO — no sólo la tabla nueva.
CREATE OR REPLACE FUNCTION public.backup_dump_table(p_table text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
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
    'recetas','receta_items','medicos','dispensacion_clases'
  ]) THEN
    RAISE EXCEPTION 'TABLE_NOT_ALLOWED: %', p_table;
  END IF;
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM %I t', p_table) INTO result;
  RETURN result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.backup_dump_table(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.backup_dump_table(text) TO service_role;
