SET lock_timeout = '5s';

-- El respaldo semanal alcanza a las bitácoras.
--
-- Ninguna de las 7 tablas del módulo estaba respaldada, y es el registro que la
-- norma manda conservar MÁS tiempo: RTS 11.02.04:24 §6.2.16 pide 2 años para
-- temperatura y humedad, y la Guía de Verificación de BPAD 3.12 pide 1 año para
-- la dispensación bajo receta. No se recuperan por resync: se anotan a mano en
-- la sala y no existen en ningún otro sistema.
--
-- Y hay un motivo de cumplimiento además del obvio: para llevar las bitácoras
-- en DIGITAL, el §6.1.15 exige un protocolo de supervisión del sistema
-- electrónico con cinco secciones, y una de ellas es «respaldo». El control
-- existía como frase —hay un backup semanal— y no alcanzaba lo que el protocolo
-- iba a declarar.
--
-- ⚠️ **Esta lista y la constante `TABLES` de `backup-critical-tables/index.ts`
-- son la MISMA lista dicha dos veces, y se mueven juntas.** Una tabla agregada
-- sólo del lado de la Edge Function falla acá con `TABLE_NOT_ALLOWED`, y como
-- el contador de fallos hace que la corrida entera reporte `ok: false`, el
-- respaldo se cae por completo — no sólo la tabla nueva.
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
    'bitacora_folios'
  ]) THEN
    RAISE EXCEPTION 'TABLE_NOT_ALLOWED: %', p_table;
  END IF;
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM %I t', p_table) INTO result;
  RETURN result;
END;
$function$;
