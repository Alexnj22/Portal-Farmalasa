-- El aviso de las 7:00 nombra el motivo nuevo del cierre automático:
-- «preventas_sin_finalizar» (2026-10-28). Sin esta rama decía «no se pudo
-- comprobar la caja», que manda a mirar donde no está el problema.
-- Partido de la definición VIVA (pg_get_functiondef); sólo se agrega el WHEN.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.avisar_dias_sin_cierre(p_fecha date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dow  text[] := ARRAY['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  v_mes  text[] := ARRAY['enero','febrero','marzo','abril','mayo','junio','julio',
                         'agosto','septiembre','octubre','noviembre','diciembre'];
  v_fecha_texto text := v_dow[EXTRACT(dow FROM p_fecha)::int + 1] || ' '
                        || EXTRACT(day FROM p_fecha)::int || ' de '
                        || v_mes[EXTRACT(month FROM p_fecha)::int];
  v_n integer;
BEGIN
  WITH salas AS (
    SELECT DISTINCT a.branch_id FROM public.cortes_caja_aperturas a WHERE a.abierta_el = p_fecha
  ),
  casos AS (
    SELECT s.branch_id, b.name AS sala, ca.resultado, ca.motivo, ca.falta,
           ca.corte_hora, (ca.detalle->>'z_hora') AS z_hora
      FROM salas s
      JOIN public.branches b ON b.id = s.branch_id
      LEFT JOIN public.caja_cierres_automaticos ca
             ON ca.branch_id = s.branch_id AND ca.fecha = p_fecha
     WHERE ca.resultado = 'cerrado'
        OR NOT EXISTS (SELECT 1 FROM public.cortes_caja c
                        WHERE c.branch_id = s.branch_id AND c.fecha = p_fecha AND c.tipo = 'Z')
  ),
  destinatarios AS (
    -- La gente de la sala…
    SELECT c.branch_id, e.id AS employee_id
      FROM casos c
      JOIN public.employees e ON e.branch_id = c.branch_id
     WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
    UNION
    -- …y supervisión, por cargo y no por lista de ids.
    SELECT c.branch_id, e.id
      FROM casos c
      CROSS JOIN public.employees e
      JOIN public.roles r ON r.name IN ('Gerente General', 'Supervisor/a de Ventas')
     WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
       AND e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
  ),
  ins AS (
    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id)
    SELECT d.employee_id,
           'DIA_SIN_CIERRE',
           CASE WHEN c.resultado = 'cerrado'
                THEN c.sala || ': el portal cerró el día solo'
                ELSE c.sala || ': el día quedó sin cierre' END,
           'Nadie hizo el cierre del día del ' || v_fecha_texto || '. '
             || CASE WHEN c.resultado = 'cerrado'
                     THEN 'El portal lo hizo solo'
                          || coalesce(' a las ' || CASE WHEN c.z_hora ~ '^\d{1,2}:\d{2}' THEN public.hora_12(c.z_hora::time) ELSE c.z_hora END, '')
                          || coalesce(', con el corte de las ' || public.hora_12(c.corte_hora)
                                      || ' como último conteo', '')
                          || '. La próxima vez, cierren el día antes de irse.'
                     ELSE 'El portal no pudo hacerlo solo porque '
                          || CASE c.motivo
                               WHEN 'sin_corte_al_cierre'
                                 THEN 'no hubo un corte de caja cerca de la hora de cierre'
                               WHEN 'efectivo_sin_contar'
                                 THEN 'entraron $' || to_char(c.falta, 'FM999,990.00')
                                      || ' después del último corte y nadie los contó'
                               WHEN 'preventas_sin_finalizar'
                                 THEN 'quedaron preventas guardadas sin finalizar'
                               WHEN 'turno_parado' THEN 'el turno estaba cerrado'
                               ELSE 'no se pudo comprobar la caja' END
                          || '. Avisen a supervisión.' END,
           '/cortes',
           jsonb_build_object('fecha', p_fecha, 'fecha_texto', v_fecha_texto,
                              'sala', c.sala, 'resultado', coalesce(c.resultado, 'no_cerrado'),
                              'motivo', c.motivo),
           c.branch_id
      FROM destinatarios d
      JOIN casos c ON c.branch_id = d.branch_id
     WHERE NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                        WHERE a.recipient_id = d.employee_id
                          AND a.clave = 'DIA_SIN_CIERRE:' || c.branch_id || ':' || p_fecha)
    RETURNING recipient_id, branch_id
  ),
  marca AS (
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    SELECT 'DIA_SIN_CIERRE:' || i.branch_id || ':' || p_fecha, i.recipient_id FROM ins i
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END $function$;
