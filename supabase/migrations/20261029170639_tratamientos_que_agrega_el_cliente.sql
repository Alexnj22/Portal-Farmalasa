-- Tratamientos: el cliente agrega los que el sistema no ve (2026-10-29).
--
-- La lista automática exige compra regular de un crónico con cobertura ≥ 70%
-- a una toma diaria. Se quedan fuera quien lo toma día por medio (la
-- Cardioaspirina de 30 cada ~70 días) y lo que no viene en tabletas
-- (insulina, inhaladores, jarabes): de su nombre no se sabe cuánto dura.
-- Decisión del usuario: «si agrega».
--
--   · `origen`: 'compras' (lo detecta el sistema) o 'cliente' (lo agregó él).
--     Una fila del cliente NO se borra al recalcular aunque no cumpla la
--     regla, y su aviso no exige familia ni cobertura: él dijo que lo toma.
--   · Sólo se agrega lo que el cliente COMPRÓ en el último año y es
--     medicamento (`es_medicamento_de_tratamiento`): el aviso cuenta desde su
--     última compra, y sin compra no hay desde dónde.
--   · Cuánto dura: con tabletas, lo comprado ÷ la dosis que dice; sin forma de
--     calcularlo, los días que él dice que le dura una compra (`dura_cliente`).
--   · Quitarla la borra (`app_tratamiento_quitar`); las automáticas siguen con
--     «Ya no lo tomo».
SET lock_timeout = '5s';

ALTER TABLE public.app_tratamientos
  ADD COLUMN origen text NOT NULL DEFAULT 'compras' CHECK (origen IN ('compras', 'cliente')),
  ADD COLUMN dura_cliente smallint CHECK (dura_cliente BETWEEN 1 AND 365);
COMMENT ON COLUMN public.app_tratamientos.origen IS
  '''compras'': lo detectó app_tratamientos_detectar. ''cliente'': lo agregó el cliente; no se borra al recalcular.';
COMMENT ON COLUMN public.app_tratamientos.dura_cliente IS
  'Días que le dura una compra, según el cliente. Sólo cuando no se puede calcular (insulina, inhaladores, jarabes).';

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
    SELECT t.*, coalesce(p.nombre, t.descripcion) AS nombre, x.dosis_dia, x.dura_cliente,
           coalesce(x.origen = 'cliente', false) AS del_cliente,
           -- Días por unidad a la dosis de ESTE cliente (una diaria si no la dijo).
           public.tratamiento_dias_por_unidad(t.product_id)
             / CASE WHEN x.dosis_dia IS NOT NULL AND public.tratamiento_ajusta_dosis(t.product_id) THEN x.dosis_dia ELSE 1 END AS dpu
      FROM t LEFT JOIN public.products p ON p.id = t.product_id
      LEFT JOIN public.app_tratamientos x ON x.customer_id = t.customer_id AND x.product_id = t.product_id
     WHERE coalesce(x.origen = 'cliente', false)
        OR (t.veces >= 3 AND t.mediana BETWEEN 14 AND 100 AND t.maxg <= t.mediana * 2
            AND t.ultima >= current_date - t.mediana * 2)),
  buenos AS (
    SELECT m.*, coalesce(m.dura_cliente, round(m.unid_ultima * m.dpu)::int) AS dura,
           round(m.unid_previas * m.dpu / nullif(m.ultima - m.primera, 0), 2) AS cob
      FROM medidos m
     WHERE (m.del_cliente AND (m.dura_cliente IS NOT NULL OR m.dpu IS NOT NULL))
        OR (NOT m.del_cliente AND m.dpu IS NOT NULL
            AND (m.dosis_dia IS NOT NULL OR m.unid_previas * m.dpu / nullif(m.ultima - m.primera, 0) >= 0.70))),
  escritos AS (
    INSERT INTO public.app_tratamientos AS a (customer_id, product_id, nombre, intervalo_dias, ultima_compra, veces, dura_dias, cobertura)
    SELECT customer_id, product_id, nombre, coalesce(mediana, dura), ultima, veces, dura, least(cob, 999) FROM buenos
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
  -- La lista es la definición: lo activo que hoy no cumple, sale. Lo que
  -- agregó el cliente se queda: sólo él lo quita.
  quitados AS (
    DELETE FROM public.app_tratamientos a
     WHERE a.customer_id = ANY (p_clientes) AND a.estado = 'activo' AND a.origen = 'compras'
       AND NOT EXISTS (SELECT 1 FROM buenos b WHERE b.customer_id = a.customer_id AND b.product_id = a.product_id)
    RETURNING 1)
  SELECT (SELECT count(*) FROM escritos) + (SELECT count(*) FROM quitados) INTO v_n;
  RETURN v_n;
END $function$;

-- Lo que el cliente puede agregar: medicamentos que compró en el último año y
-- que todavía no están en su lista. `pide`: qué hay que preguntarle —
-- 'dosis' (tabletas: cuántas al día), 'dias' (no se puede calcular: cuántos
-- días le dura una compra) o 'nada' (anticonceptivos y semanales: ciclo fijo).
CREATE OR REPLACE FUNCTION public.app_tratamiento_candidatos(p_customer bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  WITH compras AS (
    SELECT ii.erp_product_id AS product_id, max(si.fecha) AS ultima
      FROM public.sales_invoices si
      JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
     WHERE si.customer_id = p_customer AND si.fecha >= current_date - 365
       AND public.venta_valida(si.estado) AND ii.erp_product_id IS NOT NULL
     GROUP BY 1)
  SELECT coalesce(json_agg(json_build_object('product_id', c.product_id, 'nombre', p.nombre, 'ultima', c.ultima,
           'pide', CASE WHEN public.tratamiento_dias_por_unidad(p.id) IS NULL THEN 'dias'
                        WHEN public.tratamiento_ajusta_dosis(p.id) THEN 'dosis' ELSE 'nada' END)
           ORDER BY c.ultima DESC, p.nombre), '[]'::json)
    INTO v
    FROM compras c
    JOIN public.products p ON p.id = c.product_id
   WHERE public.es_medicamento_de_tratamiento(p.nombre, p.principio_activo)
     AND NOT EXISTS (SELECT 1 FROM public.app_tratamientos a WHERE a.customer_id = p_customer AND a.product_id = c.product_id);
  RETURN v;
END $function$;
REVOKE EXECUTE ON FUNCTION public.app_tratamiento_candidatos(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_tratamiento_candidatos(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.app_tratamiento_agregar(p_customer bigint, p_product_id integer, p_dosis numeric, p_dias integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_nombre text; v_pa text; v_ultima date; v_unid numeric; v_dpu numeric; v_ajusta boolean; v_dura integer; v_se_acaba date;
BEGIN
  SELECT p.nombre, p.principio_activo INTO v_nombre, v_pa FROM public.products p WHERE p.id = p_product_id;
  IF v_nombre IS NULL OR NOT public.es_medicamento_de_tratamiento(v_nombre, v_pa) THEN
    RAISE EXCEPTION 'Ese producto no se puede agregar';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_tratamientos WHERE customer_id = p_customer AND product_id = p_product_id) THEN
    RAISE EXCEPTION 'Ya está en tu lista';
  END IF;
  SELECT si.fecha, sum(ii.cantidad * coalesce(ii.factor_unidades, 1)) INTO v_ultima, v_unid
    FROM public.sales_invoices si
    JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
   WHERE si.customer_id = p_customer AND si.fecha >= current_date - 365
     AND public.venta_valida(si.estado) AND ii.erp_product_id = p_product_id
   GROUP BY si.fecha ORDER BY si.fecha DESC LIMIT 1;
  IF v_ultima IS NULL THEN RAISE EXCEPTION 'No encontramos una compra de ese producto en el último año'; END IF;

  v_dpu := public.tratamiento_dias_por_unidad(p_product_id);
  v_ajusta := coalesce(public.tratamiento_ajusta_dosis(p_product_id), false);
  IF v_dpu IS NULL THEN
    IF p_dias IS NULL OR p_dias < 1 OR p_dias > 365 THEN RAISE EXCEPTION 'Dinos cuántos días te dura una compra'; END IF;
    v_dura := p_dias;
  ELSE
    IF v_ajusta AND (p_dosis IS NULL OR p_dosis <= 0 OR p_dosis > 24) THEN RAISE EXCEPTION 'Dinos cuánto tomas al día'; END IF;
    v_dura := round(v_unid * v_dpu / CASE WHEN v_ajusta THEN p_dosis ELSE 1 END)::int;
  END IF;

  INSERT INTO public.app_tratamientos (customer_id, product_id, nombre, intervalo_dias, ultima_compra, veces, dura_dias,
                                       origen, dura_cliente, dosis_dia, dosis_at)
  VALUES (p_customer, p_product_id, v_nombre, greatest(v_dura, 1), v_ultima, 1, v_dura,
          'cliente', CASE WHEN v_dpu IS NULL THEN p_dias END,
          CASE WHEN v_dpu IS NOT NULL AND v_ajusta THEN p_dosis END,
          CASE WHEN v_dpu IS NOT NULL AND v_ajusta THEN now() END);
  -- Con todo el historial: veces, cada cuánto y la duración a su dosis.
  PERFORM public.app_tratamientos_detectar(ARRAY[p_customer]);
  SELECT a.se_acaba INTO v_se_acaba FROM public.app_tratamientos a
   WHERE a.customer_id = p_customer AND a.product_id = p_product_id;
  RETURN json_build_object('ok', true, 'se_acaba', v_se_acaba);
END $function$;
REVOKE EXECUTE ON FUNCTION public.app_tratamiento_agregar(bigint, integer, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_tratamiento_agregar(bigint, integer, numeric, integer) TO service_role;

-- Quitar uno que agregó el cliente. Las automáticas no se borran: vuelven
-- solas con la próxima compra; para ellas está «Ya no lo tomo».
CREATE OR REPLACE FUNCTION public.app_tratamiento_quitar(p_customer bigint, p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  DELETE FROM public.app_tratamientos WHERE id = p_id AND customer_id = p_customer AND origen = 'cliente';
  IF NOT FOUND THEN RAISE EXCEPTION 'No encontramos ese medicamento en tu lista'; END IF;
  RETURN json_build_object('ok', true);
END $function$;
REVOKE EXECUTE ON FUNCTION public.app_tratamiento_quitar(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_tratamiento_quitar(bigint, bigint) TO service_role;

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
     AND a.dura_dias IS NOT NULL
     AND (now() AT TIME ZONE 'America/El_Salvador')::date BETWEEN a.se_acaba - 3 AND a.se_acaba + 7
     -- Lo que agregó el cliente no pasa por la regla: él dijo que lo toma.
     AND (a.origen = 'cliente'
          OR ((a.dosis_dia IS NOT NULL OR a.cobertura >= 0.70)
              AND public.familia_de_tratamiento(coalesce(p.nombre, a.nombre), p.principio_activo) IS NOT NULL))
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
           'dosis', a.dosis_dia, 'ajusta_dosis', coalesce(public.tratamiento_ajusta_dosis(a.product_id), false),
           'origen', a.origen, 'dura_cliente', a.dura_cliente)
           ORDER BY a.estado, a.se_acaba), '[]'::json)
    FROM public.app_tratamientos a WHERE a.customer_id = p_customer;
$function$;
