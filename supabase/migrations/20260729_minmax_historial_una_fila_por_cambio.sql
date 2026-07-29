-- F2.1 (segunda mitad) — una fila de historial por cambio REAL de MIN/MAX.
--
-- Quitar los INSERT explicitos de las 3 RPCs (migracion
-- 20260729_minmax_f2_historial_datadays_sparse) no alcanzo: medido con un
-- recalculo real de Salud 4 en BEGIN…ROLLBACK, seguian saliendo 509 pares
-- duplicados en el mismo segundo — exactamente el numero de filas
-- auto-aplicadas.
--
-- La causa no era el doble INSERT, era el doble UPDATE dentro de la MISMA
-- llamada: calculate_stock_params escribe cada fila dos veces —
--
--   1. main_upsert actualiza las columnas de analitica en vivo (abc_class,
--      daily_velocity, units_sold_6m…) para que la UI muestre datos frescos
--      aunque el borrador no se publique. NO toca min_units/max_units.
--   2. auto_apply, mas abajo, aplica min_units/max_units de los borradores
--      dentro del ±40%.
--
-- El trigger capturaba en las dos, porque su condicion incluia
-- daily_velocity. La fila del paso 1 es un estado transitorio que nunca
-- existio como estado de negocio: mismo MIN/MAX que antes, pero velocidad
-- nueva. Y como las dos escrituras van en la misma transaccion, comparten
-- captured_at al segundo — que es justo lo que hacia irrecuperable el orden.
--
-- Se acota la condicion a min_units/max_units. Con eso:
--   · recalculo → 1 fila por producto cuyo MIN/MAX cambio (509 en vez de 2,404)
--   · publish   → 1 fila por producto publicado (antes 2: trigger + INSERT)
--   · un cambio de velocidad sin cambio de MIN/MAX ya no escribe historial.
--
-- Eso ultimo es a proposito: el historial es "Historial de calculos" y cada
-- linea pinta MIN → MAX; una fila cuyo MIN/MAX es identico al de la linea
-- anterior no cuenta nada. La velocidad de cada fila se sigue guardando, y es
-- la que estaba vigente cuando ese MIN/MAX dejo de ser cierto — que es
-- precisamente el "por que" del numero.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_psp_capture_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Solo el par MIN/MAX. daily_velocity salio de la condicion: cambia en cada
  -- recalculo sin que el MIN/MAX se mueva, y generaba una fila transitoria por
  -- producto con el mismo captured_at que la real (ver cabecera de la
  -- migracion 20260729_minmax_historial_una_fila_por_cambio).
  IF (OLD.min_units IS DISTINCT FROM NEW.min_units
   OR OLD.max_units IS DISTINCT FROM NEW.max_units) THEN
    INSERT INTO product_stock_params_history
      (erp_product_id, erp_sucursal_id,
       min_units, max_units, daily_velocity, velocity_30d,
       abc_class, demand_variability, cv, calculated_at)
    VALUES
      (OLD.erp_product_id, OLD.erp_sucursal_id,
       OLD.min_units, OLD.max_units, OLD.daily_velocity, OLD.velocity_30d,
       OLD.abc_class, OLD.demand_variability, OLD.cv, OLD.calculated_at);
  END IF;
  RETURN NEW;
END;
$function$;
