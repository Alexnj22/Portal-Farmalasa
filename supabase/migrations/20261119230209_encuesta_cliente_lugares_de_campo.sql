-- Los lugares de campo ya usados, para sugerirlos al encuestador (2026-11-19,
-- usuario: «2 días seguidos voy al mismo lugar, y en una escribo mercado y en
-- otra mercado central, lo tomaría como 2 lugares… que mañana al escribir
-- mercado lo encuentre como guardado, o por mi ubicación lo sugiera»).
--
-- Agrupa como `encuesta_cliente_ubicaciones` (sin mayúsculas ni espacios de
-- sobra) y además sin tildes. De cada grupo devuelve la forma más escrita, el
-- centro de sus puntos (sólo los de precisión ≤ 200 m) y la última vez. Es de
-- TODO el equipo y de todas las encuestas: así dos encuestadores usan el mismo
-- nombre. La distancia la calcula el teléfono (no recibe coordenadas: un solo
-- plan, sin parámetros).
--
-- DEFINER porque quien aplica (encuestas_aplicar) no lee las respuestas; sólo
-- devuelve nombres de lugares y su centro, nada del cliente.
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS encuesta_cliente_respuestas_campo_idx
    ON public.encuesta_cliente_respuestas (created_at) WHERE canal = 'campo';

CREATE OR REPLACE FUNCTION public.encuesta_cliente_lugares_de_campo()
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF NOT (public.auth_has_module_permission('encuestas_aplicar', 'can_view')
            OR public.auth_has_module_permission('encuestas_clientes', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    RETURN (
        SELECT coalesce(json_agg(json_build_object(
                   'lugar', x.lugar, 'respuestas', x.n, 'lat', x.lat, 'lng', x.lng, 'ultima', x.ultima)
                   ORDER BY x.ultima DESC), '[]'::json)
          FROM (SELECT mode() WITHIN GROUP (ORDER BY l.limpio DESC) AS lugar,  -- empate: «Mercado» antes que «mercado»
                       count(*) AS n,
                       avg(l.lat) FILTER (WHERE l.lat IS NOT NULL AND coalesce(l.precision_m, 0) <= 200) AS lat,
                       avg(l.lng) FILTER (WHERE l.lat IS NOT NULL AND coalesce(l.precision_m, 0) <= 200) AS lng,
                       max(l.created_at) AS ultima
                  FROM (SELECT btrim(regexp_replace(r.lugar, '\s+', ' ', 'g')) AS limpio,
                               r.lat, r.lng, r.precision_m, r.created_at
                          FROM public.encuesta_cliente_respuestas r
                         WHERE r.canal = 'campo'
                           AND r.created_at > now() - interval '365 days'
                           AND nullif(btrim(r.lugar), '') IS NOT NULL) l
                 GROUP BY lower(extensions.unaccent(l.limpio))
                 ORDER BY max(l.created_at) DESC
                 LIMIT 300) x
    );
END $$;

REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_lugares_de_campo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encuesta_cliente_lugares_de_campo() TO authenticated, service_role;
