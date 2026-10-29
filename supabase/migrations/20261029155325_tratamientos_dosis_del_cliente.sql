-- Tratamientos: la dosis la pone el cliente (2026-10-29).
--
-- 20261029154528 calcula cuánto dura lo comprado a UNA toma diaria. Quien toma
-- dos al día se queda sin medicina a la mitad, y quien toma media tableta
-- recibe el aviso con medio frasco. Al guardar «Recordarme tomarlo» en la app
-- (cuántas veces al día y cuánto cada vez), la app manda SÓLO la dosis diaria
-- —los horarios se quedan en el teléfono— y con ella se calcula:
--   · dura_dias = lo comprado ÷ dosis_dia, y la cobertura también.
--   · Con dosis del cliente no se exige la cobertura del 70%: el cliente dijo
--     que lo toma. Sí siguen el ritmo de compra y la lista de crónicos.
--   · Anticonceptivos y alendronato no la usan: su ciclo es fijo (28/30/90
--     días, una por semana) y la app no pregunta la dosis.
-- Sin dosis (o al quitar el recordatorio) vuelve a una toma diaria.
SET lock_timeout = '5s';

ALTER TABLE public.app_tratamientos
  ADD COLUMN dosis_dia numeric(5,2) CHECK (dosis_dia > 0 AND dosis_dia <= 24),
  ADD COLUMN dosis_at timestamptz;
COMMENT ON COLUMN public.app_tratamientos.dosis_dia IS
  'Tabletas al día según el cliente («Recordarme tomarlo»). NULL = una diaria.';

-- ¿La duración de este producto depende de cuánto se toma al día?
CREATE OR REPLACE FUNCTION public.tratamiento_ajusta_dosis(p_product_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT public.tratamiento_dias_por_unidad(p.id) IS NOT NULL
         AND public.familia_de_tratamiento(p.nombre, p.principio_activo) NOT IN ('anticonceptivo', 'huesos')
    FROM public.products p WHERE p.id = p_product_id;
$function$;
REVOKE EXECUTE ON FUNCTION public.tratamiento_ajusta_dosis(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tratamiento_ajusta_dosis(integer) TO authenticated, service_role;

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
    SELECT t.*, coalesce(p.nombre, t.descripcion) AS nombre, x.dosis_dia,
           -- Días por unidad a la dosis de ESTE cliente (una diaria si no la dijo).
           public.tratamiento_dias_por_unidad(t.product_id)
             / CASE WHEN x.dosis_dia IS NOT NULL AND public.tratamiento_ajusta_dosis(t.product_id) THEN x.dosis_dia ELSE 1 END AS dpu
      FROM t LEFT JOIN public.products p ON p.id = t.product_id
      LEFT JOIN public.app_tratamientos x ON x.customer_id = t.customer_id AND x.product_id = t.product_id
     WHERE t.veces >= 3 AND t.mediana BETWEEN 14 AND 100 AND t.maxg <= t.mediana * 2
       AND t.ultima >= current_date - t.mediana * 2),
  buenos AS (
    SELECT m.*, round(m.unid_ultima * m.dpu)::int AS dura,
           round(m.unid_previas * m.dpu / (m.ultima - m.primera), 2) AS cob
      FROM medidos m
     WHERE m.dpu IS NOT NULL
       AND (m.dosis_dia IS NOT NULL OR m.unid_previas * m.dpu / (m.ultima - m.primera) >= 0.70)),
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

-- La app la llama al guardar o quitar «Recordarme tomarlo». Recalcula en el
-- acto y devuelve la fecha nueva, para que la pantalla no espere a la noche.
CREATE OR REPLACE FUNCTION public.app_tratamiento_dosis(p_customer bigint, p_product_id integer, p_dosis numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_se_acaba date;
BEGIN
  IF p_dosis IS NOT NULL AND (p_dosis <= 0 OR p_dosis > 24) THEN RAISE EXCEPTION 'Esa dosis no es válida'; END IF;
  UPDATE public.app_tratamientos
     SET dosis_dia = p_dosis, dosis_at = now(), updated_at = now()
   WHERE customer_id = p_customer AND product_id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No encontramos ese tratamiento'; END IF;
  PERFORM public.app_tratamientos_detectar(ARRAY[p_customer]);
  SELECT a.se_acaba INTO v_se_acaba FROM public.app_tratamientos a
   WHERE a.customer_id = p_customer AND a.product_id = p_product_id;
  RETURN json_build_object('ok', true, 'se_acaba', v_se_acaba);
END $function$;
REVOKE EXECUTE ON FUNCTION public.app_tratamiento_dosis(bigint, integer, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_tratamiento_dosis(bigint, integer, numeric) TO service_role;

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
     AND a.dura_dias IS NOT NULL AND (a.dosis_dia IS NOT NULL OR a.cobertura >= 0.70)
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
           'estado', a.estado, 'motivo', a.motivo,
           'dosis', a.dosis_dia, 'ajusta_dosis', coalesce(public.tratamiento_ajusta_dosis(a.product_id), false))
           ORDER BY a.estado, a.se_acaba), '[]'::json)
    FROM public.app_tratamientos a WHERE a.customer_id = p_customer;
$function$;
