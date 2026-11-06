SET lock_timeout = '5s';

-- El plan del ajuste dice cuánto en lo que se CONTÓ, no sólo en unidades
-- (2026-11-06). Prueba de Salud 4: 3 cajas de Alerkem 10 mg x 10 salían como
-- «+30 unidades» y las 5 cajas sin lote como «−50»; la jefa lo leyó como
-- cantidades erróneas. La cuenta en unidades no cambia (es la que se aplica a
-- la caja): cada línea suma `en_presentacion` = [{presentacion, cantidad}].
-- Partido de la definición viva.
CREATE OR REPLACE FUNCTION public.conteo_caja_plan(p_conteo_id uuid)
 RETURNS TABLE(erp_product_id integer, is_vencidos boolean, lineas jsonb, a_medio_contar boolean, contado_hasta timestamp with time zone, contado_desde timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  WITH it AS MATERIALIZED (
    SELECT i.*,
           (i.fisico_cantidad IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.conteo_inventario_item_history h
                            WHERE h.item_id = i.id AND h.evento = 'CIERRE')) AS medido
    FROM public.conteo_inventario_items i
    WHERE i.conteo_id = p_conteo_id
  ),
  prod AS (
    SELECT it.erp_product_id AS pid, it.is_vencidos AS venc,
           bool_or(it.medido) AND bool_or(NOT it.medido) AS medio,
           max(GREATEST(it.contado_at, it.recontado_at)) FILTER (WHERE it.medido) AS hasta,
           min(it.contado_at) FILTER (WHERE it.medido) AS desde
    FROM it GROUP BY 1, 2
    HAVING bool_or(it.medido)
  ),
  x0 AS (
    SELECT it.erp_product_id AS pid, it.is_vencidos AS venc,
           COALESCE(NULLIF(btrim(it.lote), ''), '') AS lote,
           it.fecha_vencimiento AS vence,
           COALESCE(NULLIF(btrim(it.presentacion), ''), '—') AS pres,
           sum(it.diferencia)::int AS cant,
           sum(it.diferencia * COALESCE(f.factor, 1))::int AS uni,
           bool_or(f.factor IS NULL) AS sf
    FROM it
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        substring(it.grupo_key FROM '^F(\d+)$')::int,
        substring(it.detalle FROM '^\s*1\s*[xX]\s*(\d+)\s*$')::int) AS factor
    ) f
    WHERE it.medido AND COALESCE(it.diferencia, 0) <> 0
    GROUP BY 1, 2, 3, 4, 5
  ),
  x AS (
    SELECT x0.pid, x0.venc, x0.lote, x0.vence,
           sum(x0.uni)::int AS unidades,
           bool_or(x0.sf) AS sin_factor,
           COALESCE(jsonb_agg(jsonb_build_object('presentacion', x0.pres, 'cantidad', x0.cant)
                              ORDER BY x0.pres) FILTER (WHERE x0.cant <> 0), '[]'::jsonb) AS en_pres
    FROM x0
    GROUP BY 1, 2, 3, 4
  ),
  l AS (
    SELECT x.pid, x.venc,
           jsonb_agg(jsonb_build_object('lote', x.lote, 'vence', x.vence, 'unidades', x.unidades,
                                        'factor_desconocido', x.sin_factor,
                                        'en_presentacion', x.en_pres)
                     ORDER BY x.unidades DESC, x.lote) AS lineas
    FROM x WHERE x.unidades <> 0 OR x.sin_factor
    GROUP BY 1, 2
  )
  SELECT p.pid, p.venc, l.lineas, p.medio, p.hasta, p.desde
  FROM prod p JOIN l ON l.pid = p.pid AND l.venc = p.venc;
END;
$function$;
