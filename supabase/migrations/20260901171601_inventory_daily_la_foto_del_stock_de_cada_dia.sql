-- La foto diaria de las existencias. Hoy el portal no guarda ninguna.
--
-- POR QUE HACE FALTA. `inventory` dice cuanto hay AHORA y nada mas. Sin
-- historial, el calculo de MIN·MAX no puede distinguir «este producto dejo de
-- venderse» de «este producto falto», y esas dos cosas piden lo contrario:
-- bajarle el numero al primero es correcto y al segundo cierra un circulo —
-- menos maximo, menos pedido, falta antes. La auditoria del 1-sep lo midio:
-- 505 pares en quiebre, y 80 recibieron una baja del maximo el mismo dia que
-- estaban en cero. La guarda de `20260901164324` frena el daño usando el stock
-- ACTUAL, pero es un parche al efecto: para sacar de verdad los dias de quiebre
-- del denominador de la velocidad hace falta saber que dias estuvo en cero, y
-- eso solo se sabe si se guarda.
--
-- QUE CUESTA. Medido insertando 30 dias reales en produccion (transaccion
-- revertida): 13,545 filas por dia, 33 MB los 30 dias.
--
--   al año          403 MB
--   a 24 meses      805 MB   <- el techo, no sigue creciendo
--
-- La base entera pesa hoy 1,647 MB. La alternativa barata —guardar solo los
-- pares que estan en cero— costaba 16 MB al año, pero solo sirve para el
-- calculo: no deja mirar cuanto inventario habia un dia cualquiera. Se eligio
-- la foto completa a proposito, para tener esa segunda pregunta disponible.
--
-- POR QUE 24 MESES. Cubre con margen la ventana de 180 dias del calculo, y
-- sobre todo permite comparar un mes contra el MISMO mes del año anterior —que
-- es lo unico que contesta si una ráfaga como la de GLUDETHON en agosto se
-- repite o fue un evento suelto—. Ese es el otro hueco que dejo la auditoria:
-- el calculo no ve estacionalidad de ninguna clase.
--
-- POR QUE PARTICIONADA POR MES. Purgar una tabla comun de 800 MB borrando
-- filas deja tuplas muertas y le da trabajo al autovacuum todos los meses.
-- Con particiones, la purga es un DROP: instantaneo y sin rastro. Y si algun
-- dia el espacio aprieta, se recorta soltando las particiones viejas.
--
-- LO QUE NO LLEVA, A PROPOSITO: un indice por (producto, sucursal). Costaría
-- otros ~190 MB al año y hoy no hay ninguna pantalla que consulte por producto.
-- Cuando exista, se agrega — en una tabla particionada se crea sobre el padre y
-- baja sola a todas las particiones.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.inventory_daily (
  fecha            date        NOT NULL,
  erp_sucursal_id  smallint    NOT NULL,
  erp_product_id   integer     NOT NULL,
  unidades         integer     NOT NULL,
  -- `fecha` es el dia que la foto DESCRIBE; `created_at`, cuando se tomo. Se
  -- separan porque un relleno posterior tendria la misma fecha y otro momento,
  -- y eso hay que poder distinguirlo.
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha, erp_sucursal_id, erp_product_id)
) PARTITION BY RANGE (fecha);

COMMENT ON TABLE public.inventory_daily IS
  'Foto diaria de existencias por sucursal y producto. La escribe el cron inventory-daily-snapshot a las 07:45 UTC (01:45 de El Salvador), y describe como quedo la sala al cerrar el dia anterior. Retencion 24 meses, por particiones mensuales.';

-- Particiones del mes en curso y los 15 siguientes. El cron mensual crea las
-- que faltan; esto es solo para que la tabla nazca utilizable.
DO $do$
DECLARE m date; nombre text;
BEGIN
  FOR m IN SELECT generate_series(date_trunc('month', CURRENT_DATE)::date,
                                  (date_trunc('month', CURRENT_DATE) + interval '15 months')::date,
                                  '1 month')::date
  LOOP
    nombre := 'inventory_daily_' || to_char(m, 'YYYYMM');
    IF to_regclass('public.' || nombre) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.inventory_daily FOR VALUES FROM (%L) TO (%L)',
        nombre, m, (m + interval '1 month')::date);
    END IF;
  END LOOP;
END $do$;

ALTER TABLE public.inventory_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_daily_select ON public.inventory_daily;
CREATE POLICY inventory_daily_select ON public.inventory_daily
  FOR SELECT TO authenticated USING (true);

-- Sin policy de escritura: la llena una funcion SECURITY DEFINER y nadie mas.
-- Es una tabla de solo-agregar; una fila mal escrita aca corrompe el historial
-- que se guarda justamente para poder confiar en el.

REVOKE ALL ON public.inventory_daily FROM anon;
GRANT SELECT ON public.inventory_daily TO authenticated;

-- ── El escritor ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.inventory_daily_snapshot(p_fecha date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_fecha date;
  v_filas integer;
BEGIN
  -- El cron corre a la 01:45 de El Salvador, o sea que la sala ya cerro: la
  -- foto describe el dia ANTERIOR. Se calcula en hora local y no en UTC porque
  -- el dia del negocio es el local — en UTC la madrugada ya cambio de fecha.
  v_fecha := COALESCE(p_fecha,
                      ((now() AT TIME ZONE 'America/El_Salvador') - interval '1 day')::date);

  -- Idempotente: si se vuelve a correr para la misma fecha, la foto se
  -- reemplaza entera. Borrar y reinsertar, no un upsert, porque la AUSENCIA de
  -- un producto tambien es informacion — con upsert quedarian filas de una
  -- corrida vieja que ya no corresponden.
  DELETE FROM public.inventory_daily WHERE fecha = v_fecha;

  INSERT INTO public.inventory_daily (fecha, erp_sucursal_id, erp_product_id, unidades)
  SELECT v_fecha,
         i.erp_sucursal_id,
         i.erp_product_id,
         SUM(i.cantidad * COALESCE((regexp_match(i.detalle, '\d+[xX](\d+)'))[1]::int, 1))::int
  FROM public.inventory i
  WHERE i.is_vencidos = false
    AND i.erp_product_id IS NOT NULL
  GROUP BY i.erp_sucursal_id, i.erp_product_id
  HAVING SUM(i.cantidad * COALESCE((regexp_match(i.detalle, '\d+[xX](\d+)'))[1]::int, 1)) <> 0;

  GET DIAGNOSTICS v_filas = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'fecha', v_fecha, 'filas', v_filas);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.inventory_daily_snapshot(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.inventory_daily_snapshot(date) TO service_role;

-- ── El mantenedor de particiones ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.inventory_daily_mantener_particiones()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  m date; nombre text; v_creadas int := 0; v_soltadas int := 0; r record;
  v_corte date := (date_trunc('month', CURRENT_DATE) - interval '24 months')::date;
BEGIN
  -- Crear las particiones de los proximos 3 meses si faltan. Se adelanta mas de
  -- un mes a proposito: si el cron falla una vez, la escritura del dia siguiente
  -- no revienta por no tener donde ir.
  FOR m IN SELECT generate_series(date_trunc('month', CURRENT_DATE)::date,
                                  (date_trunc('month', CURRENT_DATE) + interval '3 months')::date,
                                  '1 month')::date
  LOOP
    nombre := 'inventory_daily_' || to_char(m, 'YYYYMM');
    IF to_regclass('public.' || nombre) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.inventory_daily FOR VALUES FROM (%L) TO (%L)',
        nombre, m, (m + interval '1 month')::date);
      v_creadas := v_creadas + 1;
    END IF;
  END LOOP;

  -- Soltar lo que pasa los 24 meses. Un DROP de particion es instantaneo y no
  -- deja tuplas muertas; borrar filas de una tabla de 800 MB, si.
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    WHERE i.inhparent = 'public.inventory_daily'::regclass
      AND c.relname ~ '^inventory_daily_[0-9]{6}$'
      AND to_date(right(c.relname, 6), 'YYYYMM') < v_corte
  LOOP
    EXECUTE format('DROP TABLE public.%I', r.relname);
    v_soltadas := v_soltadas + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'creadas', v_creadas,
                            'soltadas', v_soltadas, 'corte', v_corte);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.inventory_daily_mantener_particiones() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.inventory_daily_mantener_particiones() TO service_role;
