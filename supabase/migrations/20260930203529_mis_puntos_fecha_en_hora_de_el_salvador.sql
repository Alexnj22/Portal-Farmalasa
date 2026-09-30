-- Mis puntos: la fecha de un canje, una anulación o un vencimiento se dice en
-- la hora de El Salvador (2026-09-30).
--
-- `created_at::date` convertía el instante en UTC: todo lo registrado de las
-- 6:00 p.m. en adelante salía con la fecha del DÍA SIGUIENTE. Medido antes de
-- corregir: 224 de los 1,673 canjes migrados. Y el canje toma la fecha de su
-- factura cuando la tiene: si el motor se atrasa y lo registra después de
-- medianoche, el cliente igual ve el día en que canjeó.
--
-- Partió de la definición VIVA (pg_get_functiondef); sólo cambia la rama de
-- `puntos_salida`.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.puntos_estado_cuenta(p_customer_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  SELECT json_build_object(
    'customer_id', p_customer_id,
    'saldo',   coalesce((SELECT saldo   FROM public.puntos_cuenta WHERE customer_id = p_customer_id), 0),
    'ganados', coalesce((SELECT ganados FROM public.puntos_cuenta WHERE customer_id = p_customer_id), 0),
    'usados',  coalesce((SELECT usados  FROM public.puntos_cuenta WHERE customer_id = p_customer_id), 0),
    'vencimientos', coalesce((
      SELECT json_agg(to_json(x) ORDER BY x.vence_el)
      FROM (SELECT vence_el, sum(restantes)::int AS puntos
              FROM public.puntos_lote
             WHERE customer_id = p_customer_id AND restantes > 0
             GROUP BY vence_el) x), '[]'::json),
    'movimientos', coalesce((
      SELECT json_agg(to_json(m) ORDER BY m.fecha DESC, m.id DESC)
      FROM (
        SELECT id, CASE WHEN origen = 'ajuste' THEN 'ajuste'
                        WHEN origen = 'cumpleanos' OR motivo ILIKE 'cortes%cumple%' THEN 'cumpleanos'
                        ELSE 'compra' END::text AS tipo,
               ganado_el AS fecha, sucursal, puntos,
               CASE WHEN origen = 'venta' THEN NULL ELSE motivo END AS motivo
          FROM public.puntos_lote   WHERE customer_id = p_customer_id
        UNION ALL
        SELECT s.id, s.tipo,
               CASE WHEN s.tipo = 'canje' AND si.fecha IS NOT NULL THEN si.fecha
                    ELSE (s.created_at AT TIME ZONE 'America/El_Salvador')::date END,
               s.sucursal, -s.puntos, s.motivo
          FROM public.puntos_salida s
          LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
         WHERE s.customer_id = p_customer_id
        UNION ALL
        SELECT id, 'canje_devuelto', (revertida_at AT TIME ZONE 'America/El_Salvador')::date, sucursal, puntos,
               'la factura del canje se anuló'
          FROM public.puntos_salida
         WHERE customer_id = p_customer_id AND tipo = 'canje' AND revertida_at IS NOT NULL
      ) m), '[]'::json)
  ) INTO v;
  RETURN v;
END;
$function$;
