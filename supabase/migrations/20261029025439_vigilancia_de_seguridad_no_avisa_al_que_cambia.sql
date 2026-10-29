SET lock_timeout = '5s';

-- Si el cambio de control lo hizo Edwin, no se le avisa (2026-10-28, decisión
-- del usuario: «si lo hice yo, que no llegue ya que soy quien controla todo el
-- portal»). Deshace la excepción de `20261029025157`: vuelve a llamar a
-- `notify_employees` con la sesión intacta, y ésta saltea a quien actúa.
-- Consecuencia aceptada: un cambio hecho con una sesión suya robada no avisa.
-- Lo hecho por cualquier otra persona, o directo en la base, sí.

CREATE OR REPLACE FUNCTION public.seguridad_aviso_cambio_de_control()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_quien text;
    v_key   text := coalesce(NEW.key, OLD.key);
    v_que   text;
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

    -- `notify_employees` saltea a quien hizo el cambio.
    PERFORM public.notify_employees(
        public.seguridad_destinatarios(),
        'SEGURIDAD_VIGILANCIA',
        'Cambió un control de seguridad',
        v_quien || ' ' || v_que || ' Si no lo esperabas, revísalo hoy.',
        NULL,
        jsonb_build_object('motivo', 'control_cambiado', 'control', v_key, 'operacion', TG_OP,
                           'antes', CASE WHEN TG_OP <> 'INSERT' THEN OLD.estado END,
                           'ahora', CASE WHEN TG_OP <> 'DELETE' THEN NEW.estado END,
                           'actor', v_actor),
        true,
        NULL
    );
    RETURN coalesce(NEW, OLD);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.seguridad_aviso_cambio_de_control() FROM PUBLIC, anon, authenticated;
