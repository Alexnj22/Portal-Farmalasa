-- La migración anterior llamaba a `notify_employees` con el push y el
-- metadata en orden invertido (firma: destinatarios, tipo, título, cuerpo,
-- enlace, METADATA, PUSH, sala). Lo cazó la prueba con rollback contra
-- producción antes de la primera corrida del cron: habría fallado a las 8:00.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.marketing_recordatorios_diarios()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_hoy     date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_aj      public.marketing_ajustes;
    v_n       integer := 0;
    v_lista   text;
    v_cuantas integer;
    v_sig     date := (date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')) + interval '1 month')::date;
    v_mes_sig public.marketing_meses;
    v_editan  uuid[] := public.marketing_destinatarios('can_edit');
    v_aprueban uuid[] := public.marketing_destinatarios('can_approve');
BEGIN
    SELECT * INTO v_aj FROM public.marketing_ajustes WHERE id;
    IF NOT coalesce(v_aj.recordatorios_activos, true) THEN RETURN 0; END IF;

    -- Lo programado ya salió solo: pasa a publicado cuando su día quedó atrás.
    UPDATE public.marketing_piezas
       SET estado = 'publicado',
           publicado_en = coalesce(publicado_en, ((fecha + coalesce(hora, '12:00'::time)) AT TIME ZONE 'America/El_Salvador'))
     WHERE estado = 'programado' AND fecha < v_hoy;

    -- Lo de hoy que todavía no está programado ni publicado.
    SELECT count(*), string_agg(titulo || CASE WHEN estado = 'aprobado' THEN '' ELSE ' (' ||
               CASE estado WHEN 'cambios' THEN 'con cambios' WHEN 'finalizado' THEN 'sin aprobar'
                           ELSE 'sin terminar' END || ')' END, ' · ' ORDER BY hora NULLS LAST)
      INTO v_cuantas, v_lista
      FROM public.marketing_piezas
     WHERE fecha = v_hoy AND estado NOT IN ('programado','publicado');
    IF v_cuantas > 0 AND coalesce(array_length(v_editan, 1), 0) > 0 THEN
        v_n := v_n + public.notify_employees(v_editan, 'MARKETING',
            CASE WHEN v_cuantas = 1 THEN 'Hoy toca publicar 1 pieza' ELSE 'Hoy tocan ' || v_cuantas || ' piezas' END,
            left(v_lista, 300) || '. Si ya la agendaste en la red, márcala «Programada».',
            '/marketing?tab=calendario&mes=' || to_char(v_hoy, 'YYYY-MM'), '{}'::jsonb, true, NULL);
    END IF;

    -- Lo que pasó su fecha sin salir (últimos 14 días: más atrás ya no se
    -- publica, se replanifica).
    SELECT count(*), string_agg(titulo || ' (' || to_char(fecha, 'DD/MM') || ')', ' · ' ORDER BY fecha)
      INTO v_cuantas, v_lista
      FROM public.marketing_piezas
     WHERE fecha < v_hoy AND fecha >= v_hoy - 14 AND estado NOT IN ('programado','publicado');
    IF v_cuantas > 0 THEN
        v_n := v_n + public.notify_employees(
            (SELECT array_agg(DISTINCT x) FROM unnest(v_editan || v_aprueban) x), 'MARKETING',
            v_cuantas || CASE WHEN v_cuantas = 1 THEN ' pieza pasó su fecha sin publicarse' ELSE ' piezas pasaron su fecha sin publicarse' END,
            left(v_lista, 300),
            '/marketing?tab=tablero&mes=' || to_char(v_hoy, 'YYYY-MM'), '{}'::jsonb, false, NULL);
    END IF;

    -- El calendario del mes siguiente: tres días antes del límite, el día
    -- antes y el día del límite, al diseñador; vencido, también a quien aprueba
    -- (el día después, una sola vez) y al diseñador cada día hasta que lo envíe.
    SELECT * INTO v_mes_sig FROM public.marketing_meses WHERE mes = v_sig;
    IF v_mes_sig.publicado_at IS NULL THEN
        IF extract(day FROM v_hoy) IN (v_aj.dia_limite_envio - 3, v_aj.dia_limite_envio - 1, v_aj.dia_limite_envio)
           AND coalesce(array_length(v_editan, 1), 0) > 0 THEN
            v_n := v_n + public.notify_employees(v_editan, 'MARKETING',
                'Calendario de ' || public.marketing_nombre_mes(v_sig) || ': ' ||
                CASE WHEN extract(day FROM v_hoy) = v_aj.dia_limite_envio THEN 'hoy es el último día para enviarlo'
                     ELSE 'quedan ' || (v_aj.dia_limite_envio - extract(day FROM v_hoy))::int || ' días para enviarlo' END,
                'El límite es el ' || v_aj.dia_limite_envio || ' de cada mes.',
                '/marketing?tab=calendario&mes=' || to_char(v_sig, 'YYYY-MM'), '{}'::jsonb, true, NULL);
        ELSIF extract(day FROM v_hoy) > v_aj.dia_limite_envio THEN
            v_n := v_n + public.notify_employees(
                CASE WHEN extract(day FROM v_hoy) = v_aj.dia_limite_envio + 1
                     THEN (SELECT array_agg(DISTINCT x) FROM unnest(v_editan || v_aprueban) x)
                     ELSE v_editan END,
                'MARKETING',
                'El calendario de ' || public.marketing_nombre_mes(v_sig) || ' no se ha enviado',
                'Venció el ' || v_aj.dia_limite_envio || '. ' ||
                coalesce((SELECT count(*) FROM public.marketing_piezas WHERE mes_id = v_mes_sig.id), 0) || ' pieza(s) planificadas.',
                '/marketing?tab=calendario&mes=' || to_char(v_sig, 'YYYY-MM'), '{}'::jsonb, true, NULL);
        END IF;
    END IF;

    RETURN v_n;
END $$;
