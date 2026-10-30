-- El aviso de «Carga/Descarte aplicado» le llega a TODA la sala cuando una
-- corrección de factor dejó algo sin ajustar (`correccion_de_factor.resto`
-- distinto de 0): la nota le pide a la sala una solicitud, y la puede hacer
-- cualquiera de turno (usuario, 2026-10-30). El resto sigue yendo a la jefatura.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.notificar_resolucion_movimiento_inventario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m          jsonb := coalesce(NEW.metadata, '{}'::jsonb);
    v_branch   integer := nullif(m->>'branch_id', '')::integer;
    v_quien    text;
    v_titulo   text;
    v_cuerpo   text;
    v_verbo    text;
    v_lineas   integer;
    v_unidades numeric;
    v_dest     uuid[];
    -- Sin cast: un valor raro no puede romper la aprobación, sólo no ensancha.
    v_toda     boolean := coalesce(m->'correccion_de_factor'->>'resto', '') ~ '^-?[1-9][0-9]*$';
BEGIN
    IF NEW.type NOT IN ('INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST') THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN RETURN NEW; END IF;
    IF v_branch IS NULL THEN RETURN NEW; END IF;

    SELECT array_agg(id) INTO v_dest FROM public.employees
     WHERE branch_id = v_branch AND status = 'ACTIVO'
       -- La jefatura, salvo que una corrección de factor haya dejado algo sin
       -- ajustar: entonces toda la sala, porque hay algo que pedir (2026-10-30).
       AND (v_toda OR public.rango_de_empleado(id) BETWEEN 1 AND 2)
       AND id <> NEW.employee_id
       AND (NEW.approver_id IS NULL OR id <> NEW.approver_id);

    -- Una sala sin jefatura activa no es un error: simplemente no hay a quién.
    IF v_dest IS NULL OR array_length(v_dest,1) IS NULL THEN RETURN NEW; END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = NEW.approver_id;
    v_quien    := coalesce(v_quien, 'Supervisión');
    v_verbo    := CASE NEW.status WHEN 'APPROVED' THEN 'aprobó' WHEN 'REJECTED' THEN 'rechazó' ELSE 'canceló' END;
    v_lineas   := coalesce(jsonb_array_length(m->'items'), 0);
    v_unidades := coalesce((m->>'total_unidades')::numeric, 0);

    v_titulo := CASE WHEN NEW.type = 'INVENTORY_LOAD_REQUEST'
                     THEN '📦 Carga ' || CASE NEW.status WHEN 'APPROVED' THEN 'aplicada' ELSE 'no aplicada' END
                     ELSE '🗑️ Descarte ' || CASE NEW.status WHEN 'APPROVED' THEN 'aplicado' ELSE 'no aplicado' END END;

    -- La nota hasta 280 (2026-10-30): la corrección de factor dice ahí lo que
    -- NO se ajustó y qué tiene que pedir la sala; a 140 se cortaba a la mitad.
    v_cuerpo := v_quien || ' ' || v_verbo || ' '
             || v_lineas || CASE WHEN v_lineas = 1 THEN ' producto' ELSE ' productos' END
             || ' (' || trim(to_char(v_unidades,'FM999,999,990.####'))
             || CASE WHEN v_unidades = 1 THEN ' unidad' ELSE ' unidades' END || ')'
             || coalesce(' por ' || nullif(m->>'subtipo',''), '')
             || ' en tu sala.'
             || coalesce(' — ' || left(nullif(btrim(NEW.approver_note),''), 280), '');

    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, '/requests?solicitud=' || NEW.id,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'resuelta', NEW.status),
           v_branch, NEW.approver_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo,
                'url', '/requests?solicitud=' || NEW.id,
                'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));
    RETURN NEW;
END;
$function$;

