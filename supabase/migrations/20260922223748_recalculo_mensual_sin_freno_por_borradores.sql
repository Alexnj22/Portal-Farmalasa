-- El recálculo mensual del MIN·MAX corre SIEMPRE, haya o no borradores
-- pendientes — decisión del usuario, 2026-09-22.
--
-- Hasta hoy `calculate_stock_params` se saltaba la sala entera si tenía un solo
-- borrador sin revisar, y el cron del día 1 (`auto-calculate-minmax-monthly`)
-- la dejaba con el MIN·MAX del mes anterior. Medido ese día: La Popular y
-- Salud 5 tenían UN borrador cada una, del 1-sep, sobre productos INACTIVOS
-- (PRUEBA DE EMBARAZO ADVIN, AGUA OXIGENADA FALMAR) — que la pantalla de Min·Max
-- no muestra. O sea que las dos salas iban a quedarse sin recálculo en octubre
-- por un freno que nadie podía ver ni soltar.
--
-- Dos cambios, y sólo en la guarda:
--   1. Cuando llama el cron (`service_role`) no hay guarda: el borrador viejo
--      queda pisado por el cálculo nuevo, que es lo que el usuario pidió.
--   2. El botón manual de la pantalla (usuario) conserva la guarda —pisar
--      borradores a mano sigue siendo decisión de quien los revisa—, pero ya no
--      cuentan los de productos INACTIVOS, igual que ya no contaban los ocultos.
--
-- El cuerpo NO se transcribe: sale de `prosrc` y se le reemplaza exactamente la
-- guarda; si no aparece una sola vez tal cual, la migración aborta.

SET lock_timeout = '5s';

DO $mig$
DECLARE
    v_src   text;
    v_viejo text := $a$  IF p_erp_sucursal_id IS NOT NULL THEN
    PERFORM 1 FROM product_stock_params
    WHERE erp_sucursal_id = p_erp_sucursal_id
      AND draft_status = 'pending'
      AND is_hidden IS NOT TRUE
    LIMIT 1;$a$;
    v_nuevo text := $a$  -- El cron del día 1 (service_role) recalcula SIEMPRE: decisión del usuario,
  -- 2026-09-22. Sólo el botón manual respeta los borradores pendientes, y sin
  -- contar los de productos inactivos, que la pantalla no muestra.
  IF p_erp_sucursal_id IS NOT NULL
     AND (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    PERFORM 1 FROM product_stock_params sp
    WHERE sp.erp_sucursal_id = p_erp_sucursal_id
      AND sp.draft_status = 'pending'
      AND sp.is_hidden IS NOT TRUE
      AND EXISTS (SELECT 1 FROM products p WHERE p.id = sp.erp_product_id AND p.activo)
    LIMIT 1;$a$;
BEGIN
    SELECT prosrc INTO v_src FROM pg_proc
     WHERE oid = 'public.calculate_stock_params(integer)'::regprocedure;
    IF (length(v_src) - length(replace(v_src, v_viejo, ''))) / length(v_viejo) <> 1 THEN
        RAISE EXCEPTION 'CUERPO_INESPERADO: la guarda de borradores de calculate_stock_params no aparece exactamente una vez';
    END IF;
    EXECUTE format($f$
CREATE OR REPLACE FUNCTION public.calculate_stock_params(p_erp_sucursal_id integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS %L$f$, replace(v_src, v_viejo, v_nuevo));
END
$mig$;
