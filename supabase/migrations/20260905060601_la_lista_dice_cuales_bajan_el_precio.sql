SET lock_timeout = '5s';

-- La lista de promociones dice cuáles bajan el precio en la venta.
--
-- Pedido del usuario el 2026-09-05, mirando dos tarjetas idénticas: «¿cómo se
-- distingue una que tiene descuento por otra que no?». No se distinguían — la
-- columna `descuentos_erp` existía desde el 2026-09-05 y esta función no la
-- devolvía, así que la única forma de saberlo era abrir la promoción o irse a
-- la pestaña de descuentos y cruzar las fechas a ojo.
--
-- Se devuelve el CONTEO y no el arreglo: la tarjeta sólo necesita saber si baja
-- el precio, y el número de ids no se puede leer mal como si fuera un monto.
CREATE OR REPLACE FUNCTION public.get_promociones(p_estado text DEFAULT NULL::text, p_tipo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_out json;
BEGIN
    IF NOT public.auth_has_module_permission('promociones','can_view') THEN
        RETURN NULL;
    END IF;

    SELECT coalesce(json_agg(to_json(x) ORDER BY x.inicio DESC NULLS LAST, x.nombre), '[]'::json)
      INTO v_out
      FROM (
        SELECT pm.id, pm.nombre, pm.estado, pm.nota, pm.created_at,
               pm.tipo, pm.year_month, pm.paga, pm.supplier_id,
               coalesce(array_length(pm.descuentos_erp, 1), 0) AS descuentos,
               CASE pm.tipo
                 WHEN 'laboratorio' THEN (pm.year_month || '-01')::date
                 ELSE r.inicio END AS inicio,
               CASE pm.tipo
                 WHEN 'laboratorio'
                   THEN ((pm.year_month || '-01')::date
                         + interval '1 month' - interval '1 day')::date
                 ELSE r.fin END AS fin,
               r.renglones, r.lote_total, r.abiertos,
               CASE pm.tipo
                 WHEN 'laboratorio' THEN lab.nombres
                 ELSE r.laboratorios END AS laboratorios,
               lab.niveles, lab.salas
          FROM public.promociones pm
          LEFT JOIN LATERAL (
              SELECT min(rr.inicio) AS inicio,
                     max(rr.fin)    AS fin,
                     count(*)::int  AS renglones,
                     sum(rr.lote_total)::int AS lote_total,
                     count(*) FILTER (WHERE rr.estado = 'abierto')::int AS abiertos,
                     (SELECT json_agg(DISTINCT coalesce(lb.nombre,'Sin laboratorio'))
                        FROM public.promocion_renglon r2
                        JOIN public.products p2 ON p2.id = r2.erp_product_id
                        LEFT JOIN public.laboratorios lb ON lb.id = p2.laboratorio_id
                       WHERE r2.promocion_id = pm.id) AS laboratorios
                FROM public.promocion_renglon rr
               WHERE rr.promocion_id = pm.id
          ) r ON pm.tipo = 'producto'
          LEFT JOIN LATERAL (
              SELECT (SELECT json_agg(lb.nombre ORDER BY lb.nombre)
                        FROM public.promocion_laboratorio pl
                        JOIN public.laboratorios lb ON lb.id = pl.laboratorio_id
                       WHERE pl.promocion_id = pm.id) AS nombres,
                     (SELECT count(*)::int FROM public.promocion_nivel nv
                       WHERE nv.promocion_id = pm.id) AS niveles,
                     (SELECT count(DISTINCT nu.branch_id)::int
                        FROM public.promocion_nivel_umbral nu
                       WHERE nu.promocion_id = pm.id) AS salas
          ) lab ON pm.tipo = 'laboratorio'
         WHERE (p_estado IS NULL OR pm.estado = p_estado)
           AND (p_tipo   IS NULL OR pm.tipo   = p_tipo)
      ) x;

    RETURN v_out;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_promociones(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_promociones(text, text) TO authenticated, service_role;
