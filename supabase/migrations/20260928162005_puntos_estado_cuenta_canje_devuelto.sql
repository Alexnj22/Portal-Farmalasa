SET lock_timeout = '5s';

-- El estado de cuenta muestra el canje DEVUELTO como su propio movimiento
-- (2026-09-28). Sin esto, un canje cuya factura se anuló seguía saliendo como
-- −X y nada lo compensaba: la lista no sumaba el saldo, que es justo lo que
-- hace que un cliente reclame. Ahora: «Canje −X» y, el día que se devolvió,
-- «Canje devuelto +X». Reescrita desde la definición VIVA; el único agregado
-- es el tercer UNION.
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
        SELECT id, tipo, created_at::date, sucursal, -puntos, motivo
          FROM public.puntos_salida WHERE customer_id = p_customer_id
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
