-- Tratamientos: cuenta CUÁNTO se compra, no sólo cada cuánto (2026-10-29).
--
-- La regla de la mañana (20261029151442) miraba la frecuencia y nada más. Una
-- Cardioaspirina de 30 tabletas comprada cada ~70 días salía como tratamiento
-- y no alcanza ni para la mitad de los días; un Enalapril en caja de 100
-- comprado cada ~100 días sí alcanza, y su aviso salía por el promedio de días
-- y no por cuándo se acaba lo comprado.
--
-- Ahora, además de lo anterior:
--   · Cuántos días dura cada unidad de inventario: tratamiento_dias_por_unidad().
--     Las tabletas salen del «X 100» del nombre, que describe la presentación
--     más grande (caja = 10 blísteres → 10 tabletas por blíster), a una toma
--     por día. Anticonceptivo oral: 28 días por paquete; inyectable mensual 30;
--     trimestral 90; huesos (alendronato) una por semana. Sin forma de saberlo (inhaladores, soluciones, insulina en
--     vial) → NULL, y NO cuenta: el aviso exige poder decir cuándo se acaba.
--   · Cobertura: lo comprado ANTES de la última compra, en días, sobre los días
--     entre la primera y la última. Cuenta desde 0.70 (decisión del usuario).
--     Medido: 387 → 162 tratamientos.
--   · Se acaba = última compra + lo que dura ESA compra (columna se_acaba). El
--     «Cada N días» que muestra la app sigue siendo intervalo_dias.
--   · La lista es la definición: lo activo que deja de cumplir sale. Los
--     suspendidos por el cliente se quedan.
SET lock_timeout = '5s';

ALTER TABLE public.app_tratamientos
  ADD COLUMN dura_dias integer,
  ADD COLUMN cobertura numeric(5,2),
  ADD COLUMN se_acaba date GENERATED ALWAYS AS (ultima_compra + coalesce(dura_dias, intervalo_dias)) STORED;
COMMENT ON COLUMN public.app_tratamientos.dura_dias IS 'Días que dura la última compra, a una toma diaria (tratamiento_dias_por_unidad).';
COMMENT ON COLUMN public.app_tratamientos.cobertura IS 'Días cubiertos por lo comprado antes de la última compra / días entre la primera y la última.';
COMMENT ON COLUMN public.app_tratamientos.se_acaba IS 'Cuándo se acaba lo comprado: el día del recordatorio.';

CREATE OR REPLACE FUNCTION public.tratamiento_dias_por_unidad(p_product_id integer)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
           WHEN x.familia IS NULL THEN NULL
           WHEN x.familia = 'anticonceptivo' AND x.iny THEN CASE WHEN x.nombre ~ '(PROVERA|TRIMESTR)' THEN 90 ELSE 30 END
           WHEN x.familia = 'anticonceptivo' AND x.n IS NOT NULL THEN 28.0 / x.f
           -- Alendronato y compañía: una por semana.
           WHEN x.familia = 'huesos' AND x.n IS NOT NULL AND x.n % x.f = 0 THEN 7.0 * x.n / x.f
           WHEN x.n IS NOT NULL AND x.n % x.f = 0 THEN x.n::numeric / x.f
         END
    FROM (
      SELECT upper(p.nombre) AS nombre,
             public.familia_de_tratamiento(p.nombre, p.principio_activo) AS familia,
             upper(p.nombre) ~ '(AMPOLLA|\mAMP\M|\mINY|VIAL|DEPOT)' AS iny,
             nullif(substring(upper(p.nombre) FROM '\mX\s*(\d+)(?![\d.,]|\s*(ML|MG|G|GR|L|DOSIS|UI|MCG|%))'), '')::int AS n,
             greatest(coalesce((SELECT max(pp.factor) FROM public.product_precios pp WHERE pp.product_id = p.id), 1), 1) AS f
        FROM public.products p WHERE p.id = p_product_id) x;
$function$;
REVOKE EXECUTE ON FUNCTION public.tratamiento_dias_por_unidad(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tratamiento_dias_por_unidad(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.app_tratamientos_detectar(p_clientes bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_n integer;
BEGIN
  WITH compras AS (
    SELECT si.customer_id, ii.erp_product_id AS product_id, si.fecha, max(ii.descripcion) AS descripcion,
           sum(ii.cantidad * coalesce(ii.factor_unidades, 1)) AS unidades
      FROM public.sales_invoices si
      JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
      JOIN public.customers c ON c.id = si.customer_id
     WHERE si.customer_id = ANY (p_clientes) AND si.fecha >= current_date - 365
       AND public.venta_valida(si.estado) AND ii.erp_product_id IS NOT NULL
       AND NOT public.es_cliente_mostrador(c.name, c.erp_id)
     GROUP BY 1, 2, 3),
  gaps AS (
    SELECT *, fecha - lag(fecha) OVER w AS g,
           row_number() OVER (PARTITION BY customer_id, product_id ORDER BY fecha DESC) AS rn
      FROM compras WINDOW w AS (PARTITION BY customer_id, product_id ORDER BY fecha)),
  t AS (
    SELECT customer_id, product_id, count(*)::int AS veces, min(fecha) AS primera, max(fecha) AS ultima,
           (percentile_disc(0.5) WITHIN GROUP (ORDER BY g))::int AS mediana, max(g) AS maxg,
           sum(unidades) FILTER (WHERE rn > 1) AS unid_previas, sum(unidades) FILTER (WHERE rn = 1) AS unid_ultima,
           (array_agg(descripcion ORDER BY fecha DESC))[1] AS descripcion
      FROM gaps GROUP BY 1, 2),
  medidos AS (
    SELECT t.*, coalesce(p.nombre, t.descripcion) AS nombre,
           public.tratamiento_dias_por_unidad(t.product_id) AS dpu
      FROM t LEFT JOIN public.products p ON p.id = t.product_id
     WHERE t.veces >= 3 AND t.mediana BETWEEN 14 AND 100 AND t.maxg <= t.mediana * 2
       AND t.ultima >= current_date - t.mediana * 2),
  buenos AS (
    SELECT m.*, round(m.unid_ultima * m.dpu)::int AS dura,
           round(m.unid_previas * m.dpu / (m.ultima - m.primera), 2) AS cob
      FROM medidos m
     WHERE m.dpu IS NOT NULL
       AND m.unid_previas * m.dpu / (m.ultima - m.primera) >= 0.70),
  escritos AS (
    INSERT INTO public.app_tratamientos AS a (customer_id, product_id, nombre, intervalo_dias, ultima_compra, veces, dura_dias, cobertura)
    SELECT customer_id, product_id, nombre, mediana, ultima, veces, dura, least(cob, 999) FROM buenos
    ON CONFLICT (customer_id, product_id) DO UPDATE
       SET intervalo_dias = EXCLUDED.intervalo_dias, ultima_compra = EXCLUDED.ultima_compra, veces = EXCLUDED.veces,
           nombre = EXCLUDED.nombre, dura_dias = EXCLUDED.dura_dias, cobertura = EXCLUDED.cobertura, updated_at = now(),
           -- Volvió a comprarlo después de decir «ya no lo tomo»: se reactiva.
           estado = CASE WHEN a.estado = 'suspendido' AND EXCLUDED.ultima_compra > (a.suspendido_at AT TIME ZONE 'America/El_Salvador')::date
                         THEN 'activo' ELSE a.estado END,
           motivo = CASE WHEN a.estado = 'suspendido' AND EXCLUDED.ultima_compra > (a.suspendido_at AT TIME ZONE 'America/El_Salvador')::date
                         THEN NULL ELSE a.motivo END
     WHERE (a.intervalo_dias, a.ultima_compra, a.veces, a.nombre, a.dura_dias, a.cobertura) IS DISTINCT FROM
           (EXCLUDED.intervalo_dias, EXCLUDED.ultima_compra, EXCLUDED.veces, EXCLUDED.nombre, EXCLUDED.dura_dias, EXCLUDED.cobertura)
    RETURNING 1),
  -- La lista es la definición: lo activo que hoy no cumple, sale.
  quitados AS (
    DELETE FROM public.app_tratamientos a
     WHERE a.customer_id = ANY (p_clientes) AND a.estado = 'activo'
       AND NOT EXISTS (SELECT 1 FROM buenos b WHERE b.customer_id = a.customer_id AND b.product_id = a.product_id)
    RETURNING 1)
  SELECT (SELECT count(*) FROM escritos) + (SELECT count(*) FROM quitados) INTO v_n;
  RETURN v_n;
END $function$;

-- Se avisa cuando se acaba LO COMPRADO, y sólo lo que cumple la definición
-- con su compra detrás.
CREATE OR REPLACE FUNCTION public.app_tratamientos_por_recordar(p_clientes bigint[])
 RETURNS TABLE(id bigint, customer_id bigint, product_id integer, nombre text, ultima_compra date, se_acaba date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT a.id, a.customer_id, a.product_id, a.nombre, a.ultima_compra, a.se_acaba
    FROM public.app_tratamientos a
    LEFT JOIN public.products p ON p.id = a.product_id
   WHERE a.customer_id = ANY (p_clientes) AND a.estado = 'activo'
     AND a.dura_dias IS NOT NULL AND a.cobertura >= 0.70
     AND (now() AT TIME ZONE 'America/El_Salvador')::date BETWEEN a.se_acaba - 3 AND a.se_acaba + 7
     AND public.familia_de_tratamiento(coalesce(p.nombre, a.nombre), p.principio_activo) IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.sales_invoices si
         JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
        WHERE si.customer_id = a.customer_id AND si.fecha = a.ultima_compra
          AND ii.erp_product_id = a.product_id AND public.venta_valida(si.estado));
$function$;

CREATE OR REPLACE FUNCTION public.app_tratamientos_de(p_customer bigint)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(json_build_object('id', a.id, 'product_id', a.product_id, 'nombre', a.nombre,
           'intervalo', a.intervalo_dias, 'ultima', a.ultima_compra, 'se_acaba', a.se_acaba,
           'estado', a.estado, 'motivo', a.motivo) ORDER BY a.estado, a.se_acaba), '[]'::json)
    FROM public.app_tratamientos a WHERE a.customer_id = p_customer;
$function$;

-- Los otros dos lectores (expediente y contexto del chat) son funciones
-- grandes: se cambia SÓLO la fecha sobre su definición viva, y se comprueba.
DO $$
DECLARE r record; v_def text; v_nuevo text;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('cliente_expediente', 'chat_cliente_contexto') LOOP
    v_def := pg_get_functiondef(r.oid);
    v_nuevo := replace(replace(v_def, '(a.ultima_compra + a.intervalo_dias)', 'a.se_acaba'),
                       'a.ultima_compra + a.intervalo_dias', 'a.se_acaba');
    IF v_nuevo = v_def OR v_nuevo LIKE '%ultima_compra + a.intervalo_dias%' THEN
      RAISE EXCEPTION 'no se pudo cambiar la fecha en %', r.oid::regprocedure;
    END IF;
    EXECUTE v_nuevo;
  END LOOP;
END $$;
