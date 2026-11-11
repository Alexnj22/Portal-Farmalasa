-- Lo que genera el sistema es NOTIFICACIÓN, no aviso (2026-11-11, usuario:
-- «no debe haber aviso nuevo, mejor notificación; debemos ver cuáles son avisos
-- y cuáles son notificación»). Un aviso (`announcements`) es lo que escribe una
-- PERSONA para que se lea y se confirme —y desde hoy la app lo muestra
-- obligatorio al entrar—; lo automático va a la campana (`notifications`, por
-- `notify_employees`) y no obliga a nada. De 112 avisos activos, 111 eran del
-- sistema (created_by NULL). Se reescriben las tres funciones de la base que
-- los creaban, partiendo de su definición viva; la deduplicación mira las
-- notificaciones y, por única vez, también los avisos viejos (para no repetirle
-- a nadie lo que ya se le dijo).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.avisar_dui_por_vencer(p_dias_antes integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_hoy        date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_emp        record;
    v_etapa      text;
    v_avisados   int := 0;
    v_lista      text := '';
    v_cuantos    int := 0;
    v_th         uuid[];
BEGIN
    FOR v_emp IN
        SELECT e.id, e.name, e.dui_fecha_vencimiento AS vence
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND e.dui_fecha_vencimiento IS NOT NULL
           AND coalesce(e.tipo_ficha, 'empleado') <> 'tecnica'
           AND e.dui_fecha_vencimiento <= v_hoy + p_dias_antes
         ORDER BY e.dui_fecha_vencimiento
    LOOP
        v_etapa := CASE WHEN v_emp.vence < v_hoy THEN 'vencido' ELSE 'por_vencer' END;

        v_cuantos := v_cuantos + 1;
        v_lista := v_lista || '• ' || coalesce(v_emp.name, 'Sin nombre') || ' — '
                 || CASE WHEN v_etapa = 'vencido'
                         THEN 'venció el ' || to_char(v_emp.vence, 'DD/MM/YYYY')
                         ELSE 'vence el ' || to_char(v_emp.vence, 'DD/MM/YYYY')
                              || ' (' || (v_emp.vence - v_hoy) || ' días)' END
                 || E'\n';

        -- Una vez por etapa y persona. Los avisos viejos cuentan: a quien ya se
        -- le dijo con un aviso no se le repite con una notificación.
        IF EXISTS (
            SELECT 1 FROM public.notifications n
             WHERE n.metadata->>'source' = 'dui-vencimiento'
               AND n.metadata->>'employee_id' = v_emp.id::text
               AND n.metadata->>'etapa' = v_etapa
        ) OR EXISTS (
            SELECT 1 FROM public.announcements a
             WHERE a.metadata->>'source' = 'dui-vencimiento'
               AND a.metadata->>'employee_id' = v_emp.id::text
               AND a.metadata->>'etapa' = v_etapa
        ) THEN
            CONTINUE;
        END IF;

        PERFORM public.notify_employees(
            ARRAY[v_emp.id],
            'DOCUMENT_EXPIRY',
            CASE WHEN v_etapa = 'vencido' THEN 'Tu DUI está vencido' ELSE 'Tu DUI está por vencer' END,
            CASE WHEN v_etapa = 'vencido'
                 THEN 'Tu DUI venció el ' || to_char(v_emp.vence, 'DD/MM/YYYY')
                      || '. Renuévalo y pásale el nuevo a Talento Humano para actualizar tu expediente.'
                 ELSE 'Tu DUI vence el ' || to_char(v_emp.vence, 'DD/MM/YYYY')
                      || '. Renuévalo antes de esa fecha y pásale el nuevo a Talento Humano.'
            END,
            NULL,
            jsonb_build_object('source', 'dui-vencimiento', 'employee_id', v_emp.id::text,
                               'etapa', v_etapa, 'vence_el', v_emp.vence::text),
            true);
        v_avisados := v_avisados + 1;
    END LOOP;

    IF v_cuantos = 0 THEN
        RETURN json_build_object('ok', true, 'personas', 0, 'avisadas', 0, 'resumen', false);
    END IF;

    SELECT ARRAY_AGG(id) INTO v_th
      FROM public.employees WHERE role_id = 11 AND status = 'ACTIVO';

    -- El resumen de Talento Humano, uno por día (antes, un aviso por día que se
    -- acumulaba sin leer: 29 en un mes).
    IF v_th IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.metadata->>'source' = 'dui-vencimiento-resumen'
           AND (n.created_at AT TIME ZONE 'America/El_Salvador')::date = v_hoy
    ) THEN
        PERFORM public.notify_employees(
            v_th,
            'DOCUMENT_EXPIRY',
            'DUI por vencer: ' || v_cuantos || ' ' || CASE WHEN v_cuantos = 1 THEN 'persona' ELSE 'personas' END,
            'Estos expedientes tienen el DUI vencido o a punto de vencer:' || E'\n\n' || v_lista
                || E'\nA cada persona se le avisó por su cuenta.',
            '/personal',
            jsonb_build_object('source', 'dui-vencimiento-resumen', 'personas', v_cuantos),
            false);
    END IF;

    RETURN json_build_object('ok', true, 'personas', v_cuantos, 'avisadas', v_avisados, 'resumen', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_missing_roster()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_lunes      date := CURRENT_DATE + 2;
  v_detalle    text;
  v_total      integer;
  v_th_ids     uuid[];
BEGIN
  -- Personas EN PLANILLA sin horario para la semana entrante, agrupadas por
  -- sala. Antes esto era un `count(*)` sobre toda la empresa, así que un solo
  -- horario cargado en cualquier sala apagaba el aviso para todas.
  SELECT string_agg(x.linea, E'\n' ORDER BY x.sala),
         sum(x.faltan)
    INTO v_detalle, v_total
  FROM (
    SELECT b.name AS sala,
           count(*) FILTER (WHERE r.id IS NULL) AS faltan,
           '• ' || b.name || ': ' || count(*) FILTER (WHERE r.id IS NULL) ||
             ' de ' || count(*) || ' sin horario' AS linea
    FROM public.branches b
    JOIN public.employees e
      ON e.branch_id = b.id
     AND e.status = 'ACTIVO'
     AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
    LEFT JOIN public.employee_rosters r
      ON r.employee_id = e.id
     AND r.week_start_date = v_lunes
    GROUP BY b.id, b.name
    HAVING count(*) FILTER (WHERE r.id IS NULL) > 0
  ) x;

  IF v_total IS NULL OR v_total = 0 THEN RETURN; END IF;

  SELECT ARRAY_AGG(id) INTO v_th_ids
  FROM public.employees
  WHERE role_id = 11 AND status = 'ACTIVO';

  IF v_th_ids IS NULL THEN RETURN; END IF;

  PERFORM public.notify_employees(
    v_th_ids,
    'SYSTEM',
    'Faltan horarios para la semana del ' || to_char(v_lunes, 'DD/MM/YYYY'),
    v_total || ' persona(s) todavía no tienen horario para esa semana:' || E'\n\n' ||
      v_detalle || E'\n\n' ||
      'Si no se cargan antes del lunes, el reloj de la sala usa el horario de la semana anterior.',
    '/horarios',
    jsonb_build_object('source', 'cron-roster-check', 'next_week_start', v_lunes::text,
                       'faltan', v_total, 'triggered_at', now()::text),
    true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_pago_seguro_vida()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_hoy      date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_anio     int  := extract(year FROM (now() AT TIME ZONE 'America/El_Salvador'))::int;
    v_pol      public.seguro_vida_poliza%ROWTYPE;
    v_prima    numeric;
    v_personas int;
    v_dest     uuid[];
BEGIN
    IF EXISTS (SELECT 1 FROM public.seguro_vida_pagos WHERE anio = v_anio) THEN
        RETURN json_build_object('ok', true, 'avisado', false, 'motivo', 'ya_pagado');
    END IF;
    IF EXISTS (SELECT 1 FROM public.notifications n
                WHERE n.metadata->>'source' = 'seguro-vida-pago'
                  AND n.metadata->>'anio' = v_anio::text)
       OR EXISTS (SELECT 1 FROM public.announcements a
                WHERE a.metadata->>'source' = 'seguro-vida-pago'
                  AND a.metadata->>'anio' = v_anio::text) THEN
        RETURN json_build_object('ok', true, 'avisado', false, 'motivo', 'ya_avisado');
    END IF;

    SELECT * INTO v_pol FROM public.seguro_vida_poliza LIMIT 1;
    v_prima := coalesce(v_pol.prima_por_persona, round(v_pol.suma_asegurada * v_pol.tasa_por_millar / 1000, 2));
    SELECT count(*) INTO v_personas FROM public.employees
     WHERE status = 'ACTIVO' AND coalesce(tipo_ficha, 'empleado') = 'empleado';

    SELECT array_agg(id) INTO v_dest
      FROM public.employees WHERE role_id IN (11, 2) AND status = 'ACTIVO';

    IF v_dest IS NULL THEN
        RETURN json_build_object('ok', true, 'avisado', false, 'motivo', 'sin_destinatarios');
    END IF;

    PERFORM public.notify_employees(
        v_dest,
        'SYSTEM',
        'Seguro de vida colectivo: toca el pago de ' || v_anio,
        'Este mes se paga la póliza de seguro de vida colectivo'
            || coalesce(' con ' || v_pol.aseguradora, '') || '.' || E'\n\n'
            || 'Prima por persona: $' || to_char(coalesce(v_prima, 0), 'FM999,990.00')
            || ' (' || to_char(v_pol.tasa_por_millar, 'FM990.00') || ' por millar de $'
            || to_char(v_pol.suma_asegurada, 'FM999,990.00') || ').' || E'\n'
            || 'Personas activas hoy: ' || v_personas || ' — estimado: $'
            || to_char(coalesce(v_prima, 0) * v_personas, 'FM999,990.00') || '.' || E'\n\n'
            || 'Cuando llegue el listado de la aseguradora, súbelo en Personal › Seguro de vida '
            || 'para dejar a cada persona como solvente.',
        '/personal',
        jsonb_build_object('source', 'seguro-vida-pago', 'anio', v_anio::text, 'fecha', v_hoy::text),
        true);

    RETURN json_build_object('ok', true, 'avisado', true, 'anio', v_anio, 'personas', v_personas);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_dui_por_vencer(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_missing_roster() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.avisar_pago_seguro_vida() FROM PUBLIC, anon;
