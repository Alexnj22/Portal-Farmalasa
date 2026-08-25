-- Fase 1.3 de docs/PLAN-BLINDAJE-ANTE-TERCEROS-2026-08-13.md — el portal avisa
-- solo cuando la linea base ya sirve para elegir el techo.
--
-- El punto entero de la Fase 1 es que el limite de la Fase 3.3 salga de datos y
-- no de un numero inventado. Eso necesita que pase un mes, y un mes es
-- exactamente el plazo en el que uno se olvida. Sin este aviso, el trabajo de
-- hoy queda esperando a que alguien se acuerde.
--
-- SE APAGA CUANDO ALGUIEN DECIDE, NO CUANDO ALGUIEN LO LEE. La condicion de
-- corte es `security_config.techo_exportacion.updated_by IS NOT NULL`: las filas
-- nacieron sembradas por la migracion, con autor nulo, asi que un autor puesto
-- significa que una persona movio ese interruptor —en la direccion que sea, y
-- decidir que NO va techo tambien es decidir—. Un aviso que se apaga al leerlo
-- vuelve a aparecer y se termina ignorando; uno que se apaga con la decision
-- desaparece cuando el trabajo esta hecho.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.recordar_linea_base_de_egreso()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_desde timestamptz; v_filas integer; v_dias integer; v_n integer := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM security_config
             WHERE key = 'techo_exportacion' AND updated_by IS NOT NULL) THEN
    RETURN 0;
  END IF;

  SELECT min(created_at), count(*) INTO v_desde, v_filas FROM export_log;
  IF v_desde IS NULL THEN RETURN 0; END IF;   -- todavia nadie exporto nada
  v_dias := (now()::date - v_desde::date);
  IF v_dias < 30 THEN RETURN 0; END IF;

  -- Freno contra una corrida repetida a mano. NO es la memoria del aviso —esa
  -- es `updated_by`— porque `notifications` se purga, y un freno que se purga
  -- deja de frenar sin avisar.
  IF EXISTS (SELECT 1 FROM notifications
             WHERE type = 'BLINDAJE_LINEA_BASE'
               AND created_at > now() - interval '20 days') THEN
    RETURN 0;
  END IF;

  INSERT INTO notifications (recipient_id, type, title, body, link, metadata)
  SELECT e.id, 'BLINDAJE_LINEA_BASE',
         'Ya se puede ponerle techo a lo que sale',
         format('El registro lleva %s dias y %s salidas anotadas. Con eso el limite se elige mirando lo que pasa de verdad, en vez de inventar un numero.',
                v_dias, v_filas),
         '/mantenimiento',
         jsonb_build_object('dias', v_dias, 'salidas', v_filas, 'desde', v_desde)
  FROM employees e
  WHERE coalesce(e.status,'') = 'ACTIVO'
    AND (e.system_role = 'SUPERADMIN'
         OR EXISTS (SELECT 1 FROM role_permissions rp
                    WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                      AND rp.module_key = 'sesiones' AND rp.can_edit));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

COMMENT ON FUNCTION public.recordar_linea_base_de_egreso() IS
  'Avisa una vez que export_log ya tiene un mes, para elegir el techo de exportacion con datos. Se apaga cuando alguien mueve el interruptor techo_exportacion, no cuando alguien lee el aviso.';

REVOKE EXECUTE ON FUNCTION public.recordar_linea_base_de_egreso() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recordar_linea_base_de_egreso() TO service_role;

-- Mensual: es un recordatorio, no una alarma. Dia 1 a las 15:00 UTC = 9:00 SV,
-- en horario en que hay alguien para leerlo.
SELECT cron.schedule(
  'recordar-linea-base-egreso-mensual',
  '0 15 1 * *',
  $cron$SELECT public.recordar_linea_base_de_egreso();$cron$
);
