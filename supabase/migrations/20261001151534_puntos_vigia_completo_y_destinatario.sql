SET lock_timeout = '5s';

-- A quién le avisa el vigía de puntos (decisión del usuario, 2026-10-01: «me
-- debe avisar a mí nada más»). Una FILA y no un id escrito en la función: si
-- cambia la persona se cambia el dato. Sin valor, o si la ficha ya no está
-- activa, cae a Gerencia/Administración — un aviso sin destinatario se pierde
-- en silencio.
ALTER TABLE public.puntos_config
  ADD COLUMN IF NOT EXISTS avisar_fallas_a uuid REFERENCES public.employees(id) ON DELETE SET NULL;

UPDATE public.puntos_config SET avisar_fallas_a = (SELECT id FROM public.employees WHERE id = 'bbc796d7-7435-495b-9306-a2115f44a18f') WHERE id;  -- sólo si existe: el branch de pruebas no tiene esa ficha

-- Las corridas del motor que fallaron. Sólo las fallas: una fila por minuto
-- sería churn por nada. La escribe `puntos-motor` (service_role) y la lee el
-- vigía; se purga a los 90 días dentro del propio vigía.
CREATE TABLE IF NOT EXISTS public.puntos_motor_fallas (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  error      text NOT NULL,
  detalle    jsonb
);
CREATE INDEX IF NOT EXISTS puntos_motor_fallas_created_at ON public.puntos_motor_fallas (created_at);
ALTER TABLE public.puntos_motor_fallas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS puntos_motor_fallas_select ON public.puntos_motor_fallas;
CREATE POLICY puntos_motor_fallas_select ON public.puntos_motor_fallas
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos', 'can_view')));
REVOKE ALL ON public.puntos_motor_fallas FROM anon;

-- El vigía, ampliado. Antes miraba UNA cosa (el motor detenido). Ahora:
--   1. motor detenido: ventas con cliente y nada acumulado en una hora (8–21 h)
--   2. motor con errores: 3+ corridas fallidas en la última hora — sigue
--      acumulando pero algo (canjes, anulaciones, avisos) quedó a medias
--   3. cumpleaños y vencimiento: el cron diario no está, no corrió o falló
-- Cada hallazgo avisa UNA vez por día, con notificación al teléfono.
CREATE OR REPLACE FUNCTION public.puntos_vigilar_motor()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ahora timestamp := now() AT TIME ZONE 'America/El_Salvador';
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_hora int := extract(hour FROM v_ahora)::int;
  v_dest uuid[];
  v_ventas int;
  v_ultima timestamptz;
  v_fallas int;
  v_ult_falla text;
  v_avisos jsonb := '[]'::jsonb;
  v_res jsonb := '{}'::jsonb;
  v_enviados int := 0;
  a jsonb;
  c record;
  v_job record;
  v_run record;
  v_prog timestamptz;
BEGIN
  IF public.puntos_fuente() <> 'portal'
     OR NOT coalesce((SELECT acumulacion_activa FROM public.puntos_config WHERE id), false) THEN
    RETURN json_build_object('omitido', 'el programa no funciona en el portal');
  END IF;

  DELETE FROM public.puntos_motor_fallas WHERE created_at < now() - interval '90 days';

  -- 1 · Motor detenido. Sólo en horario de ventas: de noche el silencio es lo
  -- normal. Con menos de 3 ventas no se afirma nada: una hora floja no es un
  -- motor caído.
  IF v_hora >= 8 AND v_hora < 21 THEN
    SELECT count(*) INTO v_ventas
      FROM public.sales_invoices si
      JOIN public.branches b ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
     -- `fecha` primero: tiene índice y `created_at` no, y esto corre cada 15 min.
     WHERE si.fecha >= v_hoy - 1
       AND si.created_at >= now() - interval '60 minutes'
       AND public.venta_valida(si.estado) AND si.customer_id IS NOT NULL AND si.total >= 1;
    -- Por la llave primaria hacia atrás: el lote más nuevo, sin recorrer la tabla.
    SELECT created_at INTO v_ultima FROM public.puntos_lote
     WHERE origen = 'venta' ORDER BY id DESC LIMIT 1;
    v_res := v_res || jsonb_build_object('ventas_ultima_hora', v_ventas, 'ultima_acumulacion', v_ultima);

    IF v_ventas >= 3 AND (v_ultima IS NULL OR v_ultima < now() - interval '60 minutes') THEN
      v_avisos := v_avisos || jsonb_build_object(
        'clave', 'puntos_motor_detenido:' || v_hoy,
        'tipo', 'PUNTOS_MOTOR_DETENIDO',
        'titulo', 'Los puntos dejaron de acumularse',
        'cuerpo', format('En la última hora hubo %s ventas con cliente y ninguna sumó puntos. La última acumulación fue %s. Hay que revisarlo.',
                         v_ventas, coalesce(to_char(v_ultima AT TIME ZONE 'America/El_Salvador', 'DD/MM HH12:MI AM'), 'nunca')));
    END IF;
  END IF;

  -- 2 · Motor con errores. Una falla suelta (un corte de red) se repara sola en
  -- la corrida siguiente; tres en una hora ya es algo que no se arregla solo.
  SELECT count(*), (array_agg(f.error ORDER BY f.id DESC))[1]
    INTO v_fallas, v_ult_falla
    FROM public.puntos_motor_fallas f
   WHERE f.created_at >= now() - interval '60 minutes';
  v_res := v_res || jsonb_build_object('fallas_ultima_hora', v_fallas);
  IF v_fallas >= 3 THEN
    v_avisos := v_avisos || jsonb_build_object(
      'clave', 'puntos_motor_fallas:' || v_hoy,
      'tipo', 'PUNTOS_MOTOR_FALLA',
      'titulo', 'El motor de puntos está dando errores',
      'cuerpo', format('%s corridas con error en la última hora. El último: %s', v_fallas, left(v_ult_falla, 300)));
  END IF;

  -- 3 · Los crons diarios. Se juzgan 30 min después de su hora (UTC), y la
  -- clave lleva la fecha de esa corrida: se avisa una vez por día perdido.
  FOR c IN SELECT * FROM (VALUES
      ('puntos-cumpleanos-diario', time '12:10', 'Los puntos de cumpleaños'),
      ('puntos-vencer-diario',     time '12:05', 'El vencimiento de puntos')) AS t(job, hora, que)
  LOOP
    v_prog := ((now() AT TIME ZONE 'UTC')::date + c.hora) AT TIME ZONE 'UTC';
    CONTINUE WHEN now() < v_prog + interval '30 minutes';

    SELECT jobid, active INTO v_job FROM cron.job WHERE jobname = c.job;
    IF NOT FOUND OR NOT v_job.active THEN
      v_avisos := v_avisos || jsonb_build_object(
        'clave', 'puntos_cron:' || c.job || ':' || (v_prog AT TIME ZONE 'UTC')::date,
        'tipo', 'PUNTOS_CRON_FALLA',
        'titulo', c.que || ' no están programados',
        'cuerpo', format('El proceso diario «%s» no existe o está apagado. Hoy no corrió.', c.job));
      CONTINUE;
    END IF;

    SELECT d.status, d.return_message INTO v_run
      FROM cron.job_run_details d
     WHERE d.jobid = v_job.jobid AND d.start_time >= v_prog - interval '5 minutes'
     ORDER BY d.start_time DESC LIMIT 1;
    IF NOT FOUND THEN
      v_avisos := v_avisos || jsonb_build_object(
        'clave', 'puntos_cron:' || c.job || ':' || (v_prog AT TIME ZONE 'UTC')::date,
        'tipo', 'PUNTOS_CRON_FALLA',
        'titulo', c.que || ': hoy no corrió',
        'cuerpo', format('El proceso diario «%s» debía correr a las %s y no hay rastro de la corrida.',
                         c.job, to_char(v_prog AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM')));
    ELSIF v_run.status <> 'succeeded' THEN
      v_avisos := v_avisos || jsonb_build_object(
        'clave', 'puntos_cron:' || c.job || ':' || (v_prog AT TIME ZONE 'UTC')::date,
        'tipo', 'PUNTOS_CRON_FALLA',
        'titulo', c.que || ': falló hoy',
        'cuerpo', format('El proceso diario «%s» terminó con error: %s', c.job, left(coalesce(v_run.return_message, v_run.status), 300)));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_avisos) = 0 THEN
    RETURN (v_res || jsonb_build_object('ok', true))::json;
  END IF;

  -- A quién: la persona configurada; si no hay o ya no está activa, Gerencia y
  -- Administración, para que el aviso no se pierda.
  SELECT ARRAY[e.id] INTO v_dest
    FROM public.puntos_config pc JOIN public.employees e ON e.id = pc.avisar_fallas_a
   WHERE pc.id AND e.status = 'ACTIVO';
  IF v_dest IS NULL THEN
    SELECT array_agg(e.id) INTO v_dest FROM public.employees e
     WHERE e.status = 'ACTIVO' AND e.role_id IN (2, 3);
  END IF;

  FOR a IN SELECT * FROM jsonb_array_elements(v_avisos) LOOP
    -- Una vez por día: el aviso es para que alguien mire, no una alarma que
    -- suena cada quince minutos hasta que la apaguen.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications WHERE metadata->>'check_key' = a->>'clave')
               OR EXISTS (SELECT 1 FROM public.avisos_diferidos
                           WHERE entregado_at IS NULL AND notificacion->'metadata'->>'check_key' = a->>'clave');
    PERFORM public.notify_employees(v_dest, a->>'tipo', a->>'titulo', a->>'cuerpo',
      '/puntos?tab=resumen', jsonb_build_object('check_key', a->>'clave'), true, NULL);
    v_enviados := v_enviados + 1;
  END LOOP;

  RETURN (v_res || jsonb_build_object('ok', false, 'hallazgos', v_avisos, 'avisados', v_enviados))::json;
END;
$function$;
