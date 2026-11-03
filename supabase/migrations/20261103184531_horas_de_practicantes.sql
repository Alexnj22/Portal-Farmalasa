-- ── Las horas que lleva cada practicante (2026-11-03) ──────────────────────
--
-- Pedido del usuario: «haremos funcionar el kiosko para ellos, y así saber cómo
-- están con los horarios si cumplen». La pasantía tiene una meta
-- (`practicantes.horas_requeridas`); esto dice cuánto lleva, sacado de sus
-- marcajes en el kiosco entre `fecha_inicio` y hoy (o `fecha_fin`, lo que
-- llegue antes).
--
-- La jornada de un día es la misma que cuenta la planilla
-- (`consolidate-timesheets`): de la primera entrada a la última salida, menos
-- el almuerzo. Un día con entrada y sin salida NO suma —no se inventa a qué
-- hora se fue— y se cuenta aparte en `dias_sin_salida` para que se vea.
--
-- DEFINER porque `attendance` es de Asistencia y quien mira Practicantes tiene
-- `staff_list`; la guarda es ese mismo permiso. `RETURNS json` para no quedar
-- bajo el techo de 1000 filas.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_horas_de_practicantes()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
    IF NOT (SELECT public.auth_has_module_permission('staff_list', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    RETURN (
        WITH p AS (
            SELECT pr.id, pr.employee_id, pr.fecha_inicio,
                   least(pr.fecha_fin, (now() AT TIME ZONE 'America/El_Salvador')::date) AS hasta
              FROM public.practicantes pr
             WHERE pr.employee_id IS NOT NULL
        ),
        m AS (
            SELECT p.id AS pid,
                   (a.timestamp AT TIME ZONE 'America/El_Salvador')::date AS dia,
                   a.type, a.timestamp AS ts
              FROM p
              JOIN public.attendance a
                ON a.employee_id = p.employee_id
               AND a.timestamp >= (p.fecha_inicio::timestamp AT TIME ZONE 'America/El_Salvador')
               AND a.timestamp <  ((p.hasta + 1)::timestamp AT TIME ZONE 'America/El_Salvador')
        ),
        d AS (
            SELECT pid, dia,
                   min(ts) FILTER (WHERE type IN ('IN', 'IN_EXTRA'))               AS entrada,
                   max(ts) FILTER (WHERE type IN ('OUT', 'OUT_EXTRA', 'OUT_EARLY')) AS salida,
                   min(ts) FILTER (WHERE type = 'OUT_LUNCH')                       AS sale_almuerzo,
                   max(ts) FILTER (WHERE type = 'IN_LUNCH')                        AS vuelve_almuerzo
              FROM m
             GROUP BY pid, dia
        ),
        n AS (
            SELECT pid, dia, entrada, salida,
                   CASE WHEN entrada IS NOT NULL AND salida > entrada THEN
                       greatest(0, extract(epoch FROM salida - entrada) / 60
                           - CASE WHEN sale_almuerzo IS NOT NULL AND vuelve_almuerzo > sale_almuerzo
                                  THEN extract(epoch FROM vuelve_almuerzo - sale_almuerzo) / 60
                                  ELSE 0 END)
                   ELSE 0 END AS minutos
              FROM d
        )
        SELECT coalesce(json_agg(json_build_object(
                   'practicante_id',  t.pid,
                   'horas',           round((t.minutos / 60)::numeric, 2),
                   'dias',            t.dias,
                   'dias_sin_salida', t.sin_salida,
                   'ultimo_dia',      t.ultimo)), '[]'::json)
          FROM (
            SELECT pid, sum(minutos) AS minutos,
                   count(*) FILTER (WHERE entrada IS NOT NULL) AS dias,
                   count(*) FILTER (WHERE entrada IS NOT NULL AND (salida IS NULL OR salida <= entrada)) AS sin_salida,
                   max(dia) AS ultimo
              FROM n
             GROUP BY pid
          ) t
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_horas_de_practicantes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_horas_de_practicantes() TO authenticated, service_role;
