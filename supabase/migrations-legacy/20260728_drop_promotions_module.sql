-- Retiro del módulo Promociones (2026-07-28).
--
-- El frontend se borró en v2.167.0 y con él la única forma de dar de alta una
-- promoción (PromoModal). Lo que quedaba en BD era 1 promoción de prueba —
-- creada el 8 de junio con un rango del 1 al 15 de enero, ya vencido, y sin
-- stock_inicial— más su producto y las 6 sucursales. El caché de ventas nunca
-- tuvo una sola fila porque nunca hubo una promo `active`.
--
-- Bonificaciones se construirá después, con su propio esquema.

SET lock_timeout = '5s';

-- 1. El cron deja de correr ANTES de tocar las tablas.
--    Corría 4:30am y desde hacía 14 noches salía en 0: sin promos activas la
--    función retorna antes de consultar sales_invoice_items.
SELECT cron.unschedule('sync-promo-sales-daily');

-- 2. `backup_dump_table` lista las tablas permitidas. Sin quitarlas de ahí, el
--    backup nocturno reportaría 5 fallos por noche (los captura por tabla y
--    sigue, así que no se rompería — pero sería ruido permanente).
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
    'vacation_plan_headers','vacation_plans','audit_logs'
  ]) THEN
    RAISE EXCEPTION 'TABLE_NOT_ALLOWED: %', p_table;
  END IF;
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM %I t', p_table) INTO result;
  RETURN result;
END;
$function$;

-- 3. Las 6 tablas, hijas primero. Verificado antes de aplicar: cero FKs
--    entrantes desde fuera del módulo y cero tipos enum propios.
--    `employee_timeline` menciona 'promotion' pero es un literal de evento de
--    empleado ("ascenso / cambio de cargo") — no toca este módulo.
DROP TABLE IF EXISTS public.promotion_sales_cache   CASCADE;
DROP TABLE IF EXISTS public.promotion_payments      CASCADE;
DROP TABLE IF EXISTS public.promotion_bonifications CASCADE;
DROP TABLE IF EXISTS public.promotion_products      CASCADE;
DROP TABLE IF EXISTS public.promotion_branches      CASCADE;
DROP TABLE IF EXISTS public.promotions              CASCADE;
