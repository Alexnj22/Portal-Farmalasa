-- Resultados de encuestas a clientes con más filtros (pedido del usuario, 2026-11-20):
-- fechas, una respuesta, entrevistador y zona, además de la sucursal.
--
-- Un solo juez del filtro (`encuesta_cliente_filtra`) que leen los tres que
-- muestran respuestas: resultados, comentarios y el CSV. Así lo que se ve, lo
-- que se lee y lo que se exporta son siempre las mismas respuestas.
--
-- `p_filtros` (jsonb, todas las claves opcionales):
--   desde, hasta    fecha 'YYYY-MM-DD', hora de El Salvador, ambas incluidas
--   entrevistador   uuid del empleado
--   zona            id de la zona de campo ('z1', …)
--   pregunta, valor la respuesta a esa pregunta es ese valor (en una de
--                   opción múltiple, lo marcó entre otros). La clave del valor
--                   es la misma del `conteo` de `por_pregunta`.
--
-- Cambia la firma: se BORRAN las viejas para que la llamada de dos argumentos
-- (la de la app, que sigue igual) no quede ambigua, y los permisos se vuelven
-- a dar a la firma nueva.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.encuesta_cliente_filtra(p_r public.encuesta_cliente_respuestas, p_f jsonb)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
    SELECT p_f IS NULL OR (
        (nullif(p_f ->> 'desde', '') IS NULL OR (p_r.created_at AT TIME ZONE 'America/El_Salvador')::date >= (p_f ->> 'desde')::date)
    AND (nullif(p_f ->> 'hasta', '') IS NULL OR (p_r.created_at AT TIME ZONE 'America/El_Salvador')::date <= (p_f ->> 'hasta')::date)
    AND (nullif(p_f ->> 'entrevistador', '') IS NULL OR p_r.entrevistador_id = (p_f ->> 'entrevistador')::uuid)
    AND (nullif(p_f ->> 'zona', '') IS NULL OR p_r.zona = p_f ->> 'zona')
    AND (nullif(p_f ->> 'pregunta', '') IS NULL OR nullif(p_f ->> 'valor', '') IS NULL OR (
            CASE WHEN jsonb_typeof(p_r.respuestas -> (p_f ->> 'pregunta')) = 'array'
                 THEN EXISTS (SELECT 1 FROM jsonb_array_elements(p_r.respuestas -> (p_f ->> 'pregunta')) e
                               WHERE e #>> '{}' = p_f ->> 'valor')
                 ELSE coalesce(p_r.respuestas -> (p_f ->> 'pregunta') #>> '{}' = p_f ->> 'valor', false)
            END))
    );
$$;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_filtra(public.encuesta_cliente_respuestas, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encuesta_cliente_filtra(public.encuesta_cliente_respuestas, jsonb) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.encuesta_cliente_resultados(uuid, integer);
DROP FUNCTION IF EXISTS public.encuesta_cliente_comentarios(uuid, integer);
DROP FUNCTION IF EXISTS public.encuesta_cliente_respuestas_para_exportar(uuid);

-- ── Resultados ─────────────────────────────────────────────────────────────
-- Igual que antes, más: `por_sucursal` con los filtros puestos (sin el de
-- sucursal, para poder comparar), y `filtros`: las opciones de cada filtro
-- contadas sobre TODA la encuesta, para que las listas no se encojan.
CREATE FUNCTION public.encuesta_cliente_resultados(p_id uuid, p_branch integer DEFAULT NULL, p_filtros jsonb DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v_enc public.encuestas_cliente;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'La encuesta no existe'; END IF;

    RETURN (
    WITH todas AS (
        SELECT * FROM public.encuesta_cliente_respuestas WHERE encuesta_id = p_id
    ),
    sin_sala AS (
        SELECT * FROM todas t WHERE public.encuesta_cliente_filtra(t, p_filtros)
    ),
    r AS (
        SELECT * FROM sin_sala WHERE p_branch IS NULL OR branch_id IS NOT DISTINCT FROM nullif(p_branch, -1)
    ),
    preguntas AS (
        SELECT p ->> 'id' AS id, p ->> 'tipo' AS tipo, p ->> 'texto' AS texto, p ->> 'dimension' AS dimension,
               p -> 'opciones' AS opciones, sn * 1000 + n AS orden
          FROM jsonb_array_elements(coalesce(v_enc.cuestionario -> 'secciones', '[]')) WITH ORDINALITY AS sec(s, sn),
               jsonb_array_elements(coalesce(s -> 'preguntas', '[]')) WITH ORDINALITY AS q(p, n)
    ),
    valores AS (
        SELECT r.id AS respuesta_id, r.branch_id, pr.id AS pregunta, pr.tipo, pr.dimension, kv.value AS valor
          FROM r CROSS JOIN LATERAL jsonb_each(r.respuestas) kv
          JOIN preguntas pr ON pr.id = kv.key
    ),
    nps AS (
        SELECT count(*) FILTER (WHERE nps >= 9) prom, count(*) FILTER (WHERE nps BETWEEN 7 AND 8) pas,
               count(*) FILTER (WHERE nps <= 6) det, count(nps) n
          FROM r
    )
    SELECT json_build_object(
        'total', (SELECT count(*) FROM r),
        'total_encuesta', (SELECT count(*) FROM todas),
        'con_texto', (SELECT count(DISTINCT v.respuesta_id) FROM valores v
                       WHERE v.tipo = 'texto' AND nullif(btrim(v.valor #>> '{}'), '') IS NOT NULL),
        'nps', (SELECT json_build_object('promotores', prom, 'pasivos', pas, 'detractores', det, 'respuestas', n,
                    'puntaje', CASE WHEN n > 0 THEN round((prom - det) * 100.0 / n) END) FROM nps),
        'por_sucursal', (
            SELECT coalesce(json_agg(json_build_object('branch_id', coalesce(x.branch_id, -1), 'nombre', coalesce(b.name, 'Campo'), 'respuestas', x.total,
                       'nps', x.nps, 'con_nps', x.con_nps) ORDER BY x.nps DESC NULLS LAST), '[]'::json)
              FROM (SELECT branch_id, count(*) total, count(nps) con_nps,
                           CASE WHEN count(nps) > 0 THEN round((count(*) FILTER (WHERE nps >= 9) - count(*) FILTER (WHERE nps <= 6)) * 100.0 / count(nps)) END nps
                      FROM sin_sala GROUP BY branch_id) x
              LEFT JOIN public.branches b ON b.id = x.branch_id),
        'por_dimension', (
            SELECT coalesce(json_agg(json_build_object('clave', d.clave, 'nombre', d.nombre, 'color', d.color,
                       'puntaje', x.puntaje, 'respuestas', x.n) ORDER BY d.orden), '[]'::json)
              FROM (SELECT dimension, round(avg(public.encuesta_cliente_puntaje(tipo, valor))) puntaje,
                           count(public.encuesta_cliente_puntaje(tipo, valor)) n
                      FROM valores WHERE dimension IS NOT NULL GROUP BY dimension) x
              JOIN public.encuesta_cliente_dimensiones d ON d.clave = x.dimension
             WHERE x.n > 0),
        'por_pregunta', (
            SELECT coalesce(json_agg(json_build_object(
                       'id', pr.id, 'tipo', pr.tipo, 'texto', pr.texto, 'dimension', pr.dimension, 'opciones', pr.opciones,
                       'respuestas', (SELECT count(*) FROM valores v WHERE v.pregunta = pr.id),
                       'promedio', (SELECT round(avg((v.valor #>> '{}')::numeric), 2) FROM valores v
                                     WHERE v.pregunta = pr.id AND jsonb_typeof(v.valor) = 'number'),
                       'puntaje', (SELECT round(avg(public.encuesta_cliente_puntaje(v.tipo, v.valor))) FROM valores v WHERE v.pregunta = pr.id),
                       -- Conteo por valor: número, sí/no u opción (en múltiple, cada opción marcada).
                       'conteo', (SELECT coalesce(json_object_agg(k, c), '{}'::json) FROM (
                                     SELECT CASE WHEN jsonb_typeof(v.valor) = 'array' THEN e #>> '{}' ELSE v.valor #>> '{}' END k, count(*) c
                                       FROM valores v
                                       LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.valor) = 'array' AND pr.tipo = 'multiple'
                                                                                   THEN v.valor ELSE '[]'::jsonb END) e ON true
                                      WHERE v.pregunta = pr.id AND pr.tipo NOT IN ('texto','ranking','numero')
                                        AND (pr.tipo <> 'multiple' OR e IS NOT NULL)
                                      GROUP BY 1) t),
                       -- Ordenar: posición promedio de cada opción (1 = la más importante).
                       'ranking', CASE WHEN pr.tipo = 'ranking' THEN (
                           SELECT coalesce(json_object_agg(k, pos), '{}'::json) FROM (
                               SELECT e.k, round(avg(e.pos), 2) pos
                                 FROM valores v CROSS JOIN LATERAL jsonb_array_elements_text(v.valor) WITH ORDINALITY AS e(k, pos)
                                WHERE v.pregunta = pr.id GROUP BY e.k) t) END
                   ) ORDER BY pr.orden), '[]'::json)
              FROM preguntas pr),
        'por_canal', (SELECT coalesce(json_object_agg(canal, n), '{}'::json)
                        FROM (SELECT canal, count(*) n FROM r GROUP BY canal) c),
        -- Las opciones de cada filtro, sobre toda la encuesta.
        'filtros', json_build_object(
            'sucursales', (SELECT coalesce(json_agg(json_build_object('branch_id', coalesce(x.branch_id, -1), 'nombre', coalesce(b.name, 'Campo'),
                                      'respuestas', x.n) ORDER BY coalesce(b.name, 'zzz')), '[]'::json)
                             FROM (SELECT branch_id, count(*) n FROM todas GROUP BY branch_id) x
                             LEFT JOIN public.branches b ON b.id = x.branch_id),
            'entrevistadores', (SELECT coalesce(json_agg(json_build_object('id', x.entrevistador_id, 'nombre', e.name,
                                           'respuestas', x.n) ORDER BY e.name), '[]'::json)
                                  FROM (SELECT entrevistador_id, count(*) n FROM todas WHERE entrevistador_id IS NOT NULL GROUP BY 1) x
                                  JOIN public.employees e ON e.id = x.entrevistador_id),
            'zonas', (SELECT coalesce(json_agg(json_build_object('id', z ->> 'id', 'nombre', z ->> 'nombre',
                                 'respuestas', (SELECT count(*) FROM todas t WHERE t.zona = z ->> 'id')) ORDER BY o), '[]'::json)
                        FROM jsonb_array_elements(coalesce(v_enc.zonas_campo, '[]')) WITH ORDINALITY AS zz(z, o)),
            'desde', (SELECT min((created_at AT TIME ZONE 'America/El_Salvador')::date) FROM todas),
            'hasta', (SELECT max((created_at AT TIME ZONE 'America/El_Salvador')::date) FROM todas)
        )
    ));
END $function$;

-- ── Comentarios ────────────────────────────────────────────────────────────
CREATE FUNCTION public.encuesta_cliente_comentarios(p_id uuid, p_branch integer DEFAULT NULL, p_filtros jsonb DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v_enc public.encuestas_cliente;
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = p_id;
    RETURN (
        SELECT coalesce(json_agg(to_json(t) ORDER BY t.created_at DESC), '[]'::json) FROM (
            SELECT r.id, r.created_at, r.nps, r.canal, coalesce(b.name, 'Campo') AS sucursal, p ->> 'texto' AS pregunta,
                   r.respuestas ->> (p ->> 'id') AS texto,
                   r.contacto_nombre, r.telefono
              FROM public.encuesta_cliente_respuestas r
              LEFT JOIN public.branches b ON b.id = r.branch_id
             CROSS JOIN LATERAL jsonb_array_elements(coalesce(v_enc.cuestionario -> 'secciones', '[]')) s
             CROSS JOIN LATERAL jsonb_array_elements(coalesce(s -> 'preguntas', '[]')) p
             WHERE r.encuesta_id = p_id AND (p_branch IS NULL OR r.branch_id IS NOT DISTINCT FROM nullif(p_branch, -1))
               AND public.encuesta_cliente_filtra(r, p_filtros)
               AND p ->> 'tipo' = 'texto' AND nullif(btrim(r.respuestas ->> (p ->> 'id')), '') IS NOT NULL
             ORDER BY r.created_at DESC
             LIMIT 400) t
    );
END $function$;

-- ── CSV ────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.encuesta_cliente_respuestas_para_exportar(p_id uuid, p_branch integer DEFAULT NULL, p_filtros jsonb DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
    IF NOT public.auth_has_module_permission('encuestas_clientes','can_view') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    RETURN (
        SELECT coalesce(json_agg(json_build_object(
                   'fecha', r.created_at, 'branch_id', r.branch_id, 'sucursal', coalesce(b.name, 'Campo'), 'canal', r.canal, 'lugar', r.lugar, 'lat', r.lat, 'lng', r.lng, 'nps', r.nps,
                   'respuestas', r.respuestas, 'contacto_nombre', r.contacto_nombre, 'telefono', r.telefono,
                   'entrevistador', e.name, 'duracion_seg', r.duracion_seg,
                   'zona', (SELECT z ->> 'nombre' FROM public.encuestas_cliente x, jsonb_array_elements(x.zonas_campo) z
                             WHERE x.id = p_id AND z ->> 'id' = r.zona LIMIT 1)) ORDER BY r.created_at), '[]'::json)
          FROM public.encuesta_cliente_respuestas r
          LEFT JOIN public.branches b ON b.id = r.branch_id
          LEFT JOIN public.employees e ON e.id = r.entrevistador_id
         WHERE r.encuesta_id = p_id
           AND (p_branch IS NULL OR r.branch_id IS NOT DISTINCT FROM nullif(p_branch, -1))
           AND public.encuesta_cliente_filtra(r, p_filtros)
    );
END $function$;

REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_resultados(uuid, integer, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_comentarios(uuid, integer, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_respuestas_para_exportar(uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encuesta_cliente_resultados(uuid, integer, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.encuesta_cliente_comentarios(uuid, integer, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.encuesta_cliente_respuestas_para_exportar(uuid, integer, jsonb) TO authenticated, service_role;
