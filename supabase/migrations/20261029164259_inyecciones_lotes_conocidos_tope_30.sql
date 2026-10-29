-- La lista de lotes ya usados dejó de ser una fila de botones y pasó a un
-- desplegable que se filtra al escribir (`CampoLote`): el tope de 6 cortaba
-- justo lo que el filtro necesita ver. 30 cabe con holgura en una respuesta.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.inyeccion_lotes_conocidos(p_producto text)
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
         LIMIT 30
      ) x), '[]'::json);
END;
$fn$;
