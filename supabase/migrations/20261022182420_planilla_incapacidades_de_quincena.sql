-- planilla_incapacidades_de_quincena
--
-- La planilla leía las solicitudes de incapacidad con un SELECT directo sobre
-- approval_requests. Dos defectos (prueba en vivo del 2026-10-22):
--
--  1 · El RLS de approval_requests decide con el permiso de SOLICITUDES
--      (`requests_personales` y su alcance). Quien genera la planilla con
--      alcance BRANCH no veía las incapacidades de otra sala, y esos días se
--      trataban como si no hubiera incapacidad — sin aviso.
--  2 · Filtraba por `created_at <= fin de quincena`: una incapacidad presentada
--      el 17 por días del 10 al 14 quedaba fuera de la quincena que la paga.
--
-- Esta función contesta con el permiso de PLANILLA (`payroll` can_edit, el
-- mismo que exige generarla) y filtra por el RANGO DE DÍAS de la incapacidad
-- que se cruza con la quincena, no por la fecha en que se presentó.
--
-- DEFINER porque el punto es justamente no depender del alcance de
-- solicitudes; la guarda explícita la reemplaza. plpgsql y no sql: con SET
-- search_path una LANGUAGE sql nace con plan genérico (CLAUDE.md, trampa 4).
-- RETURNS json: no cae bajo el techo de 1000 filas de PostgREST.
--
-- El rango se abre un día por lado: un día guardado como instante ISO
-- ('…T06:00:00Z') puede ser otro día en El Salvador. El cruce exacto lo hace
-- `incapacidadesPorPersona` en el navegador; acá sólo se acota.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.planilla_incapacidades_de_quincena(p_desde date, p_hasta date)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
        RAISE EXCEPTION 'RANGO_INVALIDO';
    END IF;
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['payroll'])) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    RETURN (
        SELECT coalesce(json_agg(json_build_object(
                   'id', r.id, 'employee_id', r.employee_id, 'type', r.type,
                   'status', r.status, 'metadata', r.metadata) ORDER BY r.created_at, r.id), '[]'::json)
        FROM (
            SELECT ar.id, ar.employee_id, ar.type, ar.status, ar.metadata, ar.created_at,
                   CASE WHEN pg_input_is_valid(left(coalesce(nullif(ar.metadata->>'startDate', ''), ar.metadata->>'date'), 10), 'date')
                        THEN left(coalesce(nullif(ar.metadata->>'startDate', ''), ar.metadata->>'date'), 10)::date END AS d_desde,
                   CASE WHEN pg_input_is_valid(left(ar.metadata->>'endDate', 10), 'date')
                        THEN left(ar.metadata->>'endDate', 10)::date END AS d_hasta
            FROM public.approval_requests ar
            WHERE ar.type = 'DISABILITY'
              AND ar.status IN ('APPROVED', 'PENDING')
        ) r
        WHERE r.d_desde IS NOT NULL
          AND r.d_desde <= p_hasta + 1
          AND greatest(r.d_desde, coalesce(r.d_hasta, r.d_desde)) >= p_desde - 1
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.planilla_incapacidades_de_quincena(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planilla_incapacidades_de_quincena(date, date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
