-- Auditoría de Personal 2026-10-14 · Fase 1 (S1, S3).
-- docs/PLAN-PERSONAL-AUDITORIA-2026-10-14.md
SET lock_timeout = '5s';

-- S1 · `escalera_disciplinaria` es DEFINER y no preguntaba quién llama: con
-- cualquier sesión se leían hasta 20 antecedentes disciplinarios de cualquier
-- persona, saltándose `employee_events_select`. La misma regla que esa policy:
-- uno mismo o quien ve el expediente. El cuerpo no se toca.
CREATE OR REPLACE FUNCTION public.escalera_disciplinaria(p_employee_id uuid, p_falta text, p_fecha date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_fecha    date := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date);
    v_desde    date;
    v_verbales integer;
    v_previas  integer;
    v_max      integer;
    v_peldano  integer;
    v_hist     json;
BEGIN
    IF p_employee_id IS DISTINCT FROM (SELECT public.auth_employee_id())
       AND NOT (SELECT public.auth_has_module_permission('staff_detail', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN: el historial disciplinario es del expediente';
    END IF;

    SELECT max(e.date) INTO v_desde
      FROM public.employee_events e
     WHERE e.employee_id = p_employee_id
       AND e.type = 'RECTIFICACION'
       AND e.date <= v_fecha;

    SELECT count(*) INTO v_verbales
      FROM public.employee_events e
     WHERE e.employee_id = p_employee_id
       AND e.type = 'AMONESTACION_VERBAL'
       AND e.metadata->>'falta' = p_falta
       AND e.date <= v_fecha
       AND (v_desde IS NULL OR e.date > v_desde)
       AND coalesce(e.metadata->'reclamo'->>'estado','') <> 'REVOCADA';

    SELECT count(*), coalesce(max((e.metadata->>'peldano')::int), 0)
      INTO v_previas, v_max
      FROM public.employee_events e
     WHERE e.employee_id = p_employee_id
       AND e.type IN ('AMONESTACION_VERBAL','AMONESTACION_ESCRITA','SUSPENSION')
       AND e.date <= v_fecha
       AND e.date >= v_fecha - 60
       AND (v_desde IS NULL OR e.date > v_desde)
       AND coalesce(e.metadata->'reclamo'->>'estado','') <> 'REVOCADA';

    v_peldano := CASE
        WHEN v_previas > 0 THEN least(v_max + 1, 4)
        WHEN v_verbales > 0 THEN 2
        ELSE 1
    END;

    SELECT coalesce(json_agg(to_json(h) ORDER BY h.date DESC), '[]'::json) INTO v_hist
      FROM (
        SELECT e.id, e.type, e.date, e.metadata->>'falta' AS falta,
               (e.metadata->>'peldano')::int AS peldano,
               e.metadata->'reclamo'->>'estado' AS reclamo
          FROM public.employee_events e
         WHERE e.employee_id = p_employee_id
           AND e.type IN ('AMONESTACION_VERBAL','AMONESTACION_ESCRITA','SUSPENSION','RECTIFICACION')
           AND e.date <= v_fecha
         ORDER BY e.date DESC
         LIMIT 20
      ) h;

    RETURN json_build_object(
        'peldano',              v_peldano,
        'verbales_misma_causa', v_verbales,
        'faltas_en_60_dias',    v_previas,
        'peldano_mas_alto',     v_max,
        'rectificado_el',       v_desde,
        'exige_autorizacion',   v_peldano >= 4,
        'antecedentes',         v_hist
    );
END;
$function$;

-- S3 · Una sanción se escribe SÓLO por `registrar_sancion` /
-- `registrar_rectificacion` / `resolver_reclamo_sancion` (las tres DEFINER, no
-- pasan por estas policies). El «Editar» del historial la reinsertaba directo
-- con la firma y el peldaño que traía el navegador, y el «Cancelar» la
-- borraba de la escalera sin pasar por el reclamo del Art. 77. Medido hoy: 0
-- sanciones en producción, así que esto no deja a ninguna fila sin camino.
DROP POLICY IF EXISTS employee_events_insert ON public.employee_events;
CREATE POLICY employee_events_insert ON public.employee_events
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.auth_can_edit_any(ARRAY['staff_detail']))
        AND type NOT IN ('AMONESTACION_VERBAL','AMONESTACION_ESCRITA','SUSPENSION','RECTIFICACION')
    );

DROP POLICY IF EXISTS employee_events_update ON public.employee_events;
CREATE POLICY employee_events_update ON public.employee_events
    FOR UPDATE TO authenticated
    USING (
        (SELECT public.auth_can_edit_any(ARRAY['staff_detail']))
        AND type NOT IN ('AMONESTACION_VERBAL','AMONESTACION_ESCRITA','SUSPENSION','RECTIFICACION')
    )
    WITH CHECK (
        (SELECT public.auth_can_edit_any(ARRAY['staff_detail']))
        AND type NOT IN ('AMONESTACION_VERBAL','AMONESTACION_ESCRITA','SUSPENSION','RECTIFICACION')
    );
