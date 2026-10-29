-- Los lotes ya vistos de una inyección (usuario, 2026-10-29: «que se puedan
-- guardar esos lotes / vence juntos, así si alguien más vende, ya aparece para
-- ese producto»). No es una tabla nueva: el lote y el vencimiento ya quedan en
-- cada aplicación (escritos al cobrar) o en su factura, y los lee
-- `inyeccion_lote_aplicado`. Esto los junta por PRODUCTO, de todas las salas,
-- sin los vencidos, para que la caja elija el par entero con un toque.
-- INVOKER: el RLS de las aplicaciones sigue decidiendo qué se ve.
SET lock_timeout = '5s';

CREATE FUNCTION public.inyeccion_lotes_conocidos(p_producto text)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $fn$
BEGIN
  RETURN coalesce((
    SELECT json_agg(json_build_object('lote', x.lote, 'vence', to_char(x.vence, 'YYYY-MM'), 'veces', x.veces)
                    ORDER BY x.ultima DESC)
      FROM (
        SELECT l.lote, l.vence, count(*) AS veces, max(a.created_at) AS ultima
          FROM public.inyeccion_aplicaciones a
          CROSS JOIN LATERAL public.inyeccion_lote_aplicado(a.lote, a.vence, a.invoice_id, a.linea_num) l
         WHERE upper(btrim(a.producto)) = upper(btrim(coalesce(p_producto, '')))
           AND l.lote IS NOT NULL AND l.vence IS NOT NULL
           AND l.vence >= (now() AT TIME ZONE 'America/El_Salvador')::date
         GROUP BY l.lote, l.vence
         ORDER BY max(a.created_at) DESC
         LIMIT 6
      ) x), '[]'::json);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_lotes_conocidos(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_lotes_conocidos(text) TO authenticated, service_role;
