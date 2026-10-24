-- Art. 25 LPDP, segunda mitad de 20261024162150_incidentes_de_seguridad_de_datos.sql:
-- índice, RLS, avisos y el vigilante de las 72 horas sobre incidentes_datos.
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS incidentes_datos_registrado_por_idx ON public.incidentes_datos (registrado_por);
COMMENT ON TABLE public.incidentes_datos IS
  'Art. 25 LPDP: vulneraciones de seguridad de datos personales. 72 h desde detectado_at para notificar a la Agencia de Ciberseguridad, la Fiscalía y los titulares.';

ALTER TABLE public.incidentes_datos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incidentes_datos_select ON public.incidentes_datos;
DROP POLICY IF EXISTS incidentes_datos_insert ON public.incidentes_datos;
DROP POLICY IF EXISTS incidentes_datos_update ON public.incidentes_datos;
CREATE POLICY incidentes_datos_select ON public.incidentes_datos FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('datos_personales', 'can_view')));
CREATE POLICY incidentes_datos_insert ON public.incidentes_datos FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.auth_has_module_permission('datos_personales', 'can_edit'))
              AND registrado_por = (SELECT public.auth_employee_id()));
CREATE POLICY incidentes_datos_update ON public.incidentes_datos FOR UPDATE TO authenticated
  USING ((SELECT public.auth_has_module_permission('datos_personales', 'can_edit')))
  WITH CHECK ((SELECT public.auth_has_module_permission('datos_personales', 'can_edit')));
REVOKE ALL ON public.incidentes_datos FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.incidentes_datos TO authenticated;

-- ── Quién recibe los avisos: edita `datos_personales` ──────────────────────
CREATE OR REPLACE FUNCTION public.incidentes_datos_destinatarios()
 RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT array_agg(DISTINCT e.id) FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                    AND rp.module_key = 'datos_personales' AND rp.can_edit);
$function$;
REVOKE EXECUTE ON FUNCTION public.incidentes_datos_destinatarios() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.incidentes_datos_destinatarios() TO service_role;

-- ── Al registrarse: aviso inmediato ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.incidentes_datos_al_registrar()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_dest uuid[] := public.incidentes_datos_destinatarios();
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' AND v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'DATOS_INCIDENTE', 'Se registró un incidente de seguridad de datos',
      'Hay 72 horas desde que se detectó (' || to_char(NEW.detectado_at AT TIME ZONE 'America/El_Salvador', 'DD/MM/YYYY HH24:MI')
        || ') para notificar a la Agencia de Ciberseguridad del Estado, a la Fiscalía y a las personas afectadas.',
      '/solicitudes-datos?tab=incidentes', jsonb_build_object('incidente_id', NEW.id,
        'check_key', 'datos-incidente:' || NEW.id || ':nuevo'), true, NULL);
  END IF;
  RETURN NEW;
END $function$;
REVOKE EXECUTE ON FUNCTION public.incidentes_datos_al_registrar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS incidentes_datos_al_registrar ON public.incidentes_datos;
CREATE TRIGGER incidentes_datos_al_registrar BEFORE INSERT OR UPDATE ON public.incidentes_datos
  FOR EACH ROW EXECUTE FUNCTION public.incidentes_datos_al_registrar();

-- ── El vigilante de las 72 horas ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.avisar_incidentes_datos()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dest uuid[] := public.incidentes_datos_destinatarios();
  v_f record; v_ins integer; v_clave text; v_n integer := 0;
BEGIN
  FOR v_f IN
    SELECT i.id, i.detectado_at, i.naturaleza,
           array_remove(ARRAY[CASE WHEN i.notificado_agencia_at IS NULL THEN 'la Agencia de Ciberseguridad' END,
                              CASE WHEN i.notificado_fiscalia_at IS NULL THEN 'la Fiscalía' END,
                              CASE WHEN i.notificado_titulares_at IS NULL THEN 'las personas afectadas' END], NULL) AS faltan,
           CASE WHEN now() > i.detectado_at + interval '72 hours' THEN 'vencido' ELSE 'apremia' END AS etapa
      FROM public.incidentes_datos i
     WHERE i.cerrado_at IS NULL
       AND now() > i.detectado_at + interval '48 hours'
       AND (i.notificado_agencia_at IS NULL OR i.notificado_fiscalia_at IS NULL OR i.notificado_titulares_at IS NULL)
  LOOP
    v_clave := 'datos-incidente:' || v_f.id || ':' || v_f.etapa;
    INSERT INTO public.avisos_emitidos (clave, recipient_id) VALUES (v_clave, NULL) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    CONTINUE WHEN v_ins = 0;
    IF v_f.etapa = 'vencido' THEN
      INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
      VALUES ('DATOS_INCIDENTE_72H_VENCIDAS', v_f.id::text, 'Vigilante', 'SYSTEM', 'CRITICAL',
              jsonb_build_object('detectado_at', v_f.detectado_at, 'faltan', v_f.faltan));
    END IF;
    IF v_dest IS NOT NULL THEN
      v_n := v_n + public.notify_employees(v_dest, 'DATOS_INCIDENTE',
        CASE WHEN v_f.etapa = 'vencido' THEN 'Pasaron las 72 horas de un incidente de datos sin notificar'
             ELSE 'Un incidente de datos cumple 72 horas el ' || to_char((v_f.detectado_at + interval '72 hours') AT TIME ZONE 'America/El_Salvador', 'DD/MM HH24:MI') END,
        'Falta notificar a ' || array_to_string(v_f.faltan, ', ') || '. ' || left(v_f.naturaleza, 120),
        '/solicitudes-datos?tab=incidentes', jsonb_build_object('incidente_id', v_f.id, 'check_key', v_clave), true, NULL);
    END IF;
  END LOOP;
  RETURN v_n;
END $function$;
REVOKE EXECUTE ON FUNCTION public.avisar_incidentes_datos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_incidentes_datos() TO service_role;

SELECT cron.schedule('avisar-incidentes-datos', '7 * * * *', 'SELECT public.avisar_incidentes_datos()')
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisar-incidentes-datos');
