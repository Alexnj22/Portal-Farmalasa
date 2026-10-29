-- Tratamientos: la detección filtra antes de calcular (2026-10-29).
--
-- tratamientos_duracion_fuera_de_la_lista dejó el filtro de crónicos en el
-- mismo WHERE que el de «lo agregó el cliente» (un OR con una tabla unida), y
-- el planificador dejó de poder bajar los filtros baratos al agrupado: calculaba
-- familia y duración —expresiones regulares sobre 140 patrones— para cada
-- producto que compró cada cliente. Medido: 300 clientes 0.8 s, 1,200 más de
-- 50 s. El cuerpo de la detección no cambia; sólo el orden: candidatos con
-- filtros baratos (MATERIALIZED), después las funciones sobre esos pocos.
SET lock_timeout = '5s';

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
  -- Primero los candidatos con filtros BARATOS, materializados: las funciones
  -- de abajo (familia y duración, con expresiones regulares) corren sólo sobre
  -- ellos. Mezcladas en un mismo WHERE, el planificador las evaluaba para cada
  -- producto que compró cada cliente: 1,200 clientes pasaban de 50 s.
  cand AS MATERIALIZED (
    SELECT t.*, x.dosis_dia, x.dura_cliente, coalesce(x.origen = 'cliente', false) AS del_cliente
      FROM t LEFT JOIN public.app_tratamientos x ON x.customer_id = t.customer_id AND x.product_id = t.product_id
     WHERE coalesce(x.origen = 'cliente', false)
        OR (t.veces >= 3 AND t.mediana BETWEEN 14 AND 100 AND t.maxg <= t.mediana * 2
            AND t.ultima >= current_date - t.mediana * 2)),
  medidos AS MATERIALIZED (
    SELECT c.*, coalesce(p.nombre, c.descripcion) AS nombre,
           public.familia_de_tratamiento(p.nombre, p.principio_activo) AS familia,
           -- Días por unidad a la dosis de ESTE cliente (una diaria si no la dijo).
           public.tratamiento_dias_por_unidad(c.product_id)
             / CASE WHEN c.dosis_dia IS NOT NULL AND public.tratamiento_ajusta_dosis(c.product_id) THEN c.dosis_dia ELSE 1 END AS dpu
      FROM cand c LEFT JOIN public.products p ON p.id = c.product_id),
  buenos AS (
    SELECT m.*, coalesce(m.dura_cliente, round(m.unid_ultima * m.dpu)::int) AS dura,
           round(m.unid_previas * m.dpu / nullif(m.ultima - m.primera, 0), 2) AS cob
      FROM medidos m
     WHERE (m.del_cliente AND (m.dura_cliente IS NOT NULL OR m.dpu IS NOT NULL))
        -- La lista automática es sólo de crónicos (tratamiento_moleculas).
        OR (NOT m.del_cliente AND m.familia IS NOT NULL AND m.dpu IS NOT NULL
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
