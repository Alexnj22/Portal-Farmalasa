SET lock_timeout = '5s';

-- Los avisos de la vigilancia de seguridad van SÓLO a Edwin Núñez (2026-10-28,
-- decisión del usuario: «solo a edwin. nadie mas»). Reemplaza a «Gerente
-- General y Jefe/a de TH» de `20261029023934`.
--
-- Es una persona y no un cargo a propósito: quien recibe la alerta de «alguien
-- apagó un control» tiene que ser quien NO puede apagarlo sin que se note. Por
-- eso, además, el aviso de cambio de control le llega aunque el cambio lo haya
-- hecho él mismo: `notify_employees` saltea al que actúa, y con un solo
-- destinatario eso dejaría sin aviso justo el caso de una sesión suya robada.
-- Se suelta la sesión SÓLO para esa llamada y se restaura enseguida.

CREATE OR REPLACE FUNCTION public.seguridad_destinatarios()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  -- EDWIN ALEXANDER NUNEZ JOYA (código 71018). Si su ficha deja de estar
  -- activa, la lista queda vacía y `vigilar_seguridad` devuelve
  -- «sin destinatarios» en vez de avisarle a nadie.
  SELECT coalesce(array_agg(e.id), '{}'::uuid[])
    FROM public.employees e
   WHERE e.id = 'bbc796d7-7435-495b-9306-a2115f44a18f'
     AND e.status = 'ACTIVO';
$function$;

CREATE OR REPLACE FUNCTION public.seguridad_aviso_cambio_de_control()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor  uuid := public.auth_employee_id();
    v_quien  text;
    v_key    text := coalesce(NEW.key, OLD.key);
    v_que    text;
    v_claims text := current_setting('request.jwt.claims', true);
BEGIN
    -- Cambiar sólo la nota no mueve ningún freno.
    IF TG_OP = 'UPDATE' AND NEW.estado IS NOT DISTINCT FROM OLD.estado
       AND NEW.key IS NOT DISTINCT FROM OLD.key THEN
        RETURN NEW;
    END IF;

    -- Sin sesión del portal = alguien con acceso directo a la base.
    SELECT public.nombre_corto_de_empleado(NULL, NULL, e.name) INTO v_quien
      FROM public.employees e WHERE e.id = v_actor;
    v_quien := coalesce(v_quien, 'Alguien sin sesión del portal (acceso directo a la base)');

    v_que := CASE TG_OP
        WHEN 'UPDATE' THEN format('cambió «%s»: antes %s, ahora %s.',
                                  public.seguridad_rotulo_control(v_key),
                                  public.seguridad_rotulo_estado(OLD.estado),
                                  public.seguridad_rotulo_estado(NEW.estado))
        WHEN 'DELETE' THEN format('borró el control «%s» (estaba: %s). Sin la fila, no bloquea nada.',
                                  public.seguridad_rotulo_control(v_key),
                                  public.seguridad_rotulo_estado(OLD.estado))
        ELSE               format('agregó el control «%s» (%s).',
                                  public.seguridad_rotulo_control(v_key),
                                  public.seguridad_rotulo_estado(NEW.estado))
    END;

    -- Sin actor para `notify_employees`, que si no saltearía a quien hizo el cambio.
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM public.notify_employees(
        public.seguridad_destinatarios(),
        'SEGURIDAD_VIGILANCIA',
        'Cambió un control de seguridad',
        v_quien || ' ' || v_que || ' Si no fuiste tú, revísalo hoy.',
        NULL,
        jsonb_build_object('motivo', 'control_cambiado', 'control', v_key, 'operacion', TG_OP,
                           'antes', CASE WHEN TG_OP <> 'INSERT' THEN OLD.estado END,
                           'ahora', CASE WHEN TG_OP <> 'DELETE' THEN NEW.estado END,
                           'actor', v_actor),
        true,
        NULL
    );
    PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    RETURN coalesce(NEW, OLD);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.seguridad_destinatarios() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seguridad_aviso_cambio_de_control() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.seguridad_destinatarios() TO service_role;
