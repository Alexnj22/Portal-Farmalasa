SET lock_timeout = '5s';

-- El aviso de vuelta tiene que contar los TRES desenlaces, no dos.
--
-- Contaba `aceptada` y `devuelta`, que eran todos los que había. Desde hoy un
-- renglón puede terminar en `no_llego` —el producto salió del estante y nunca
-- apareció en la caja— y con la cuenta vieja ese envío avisaba «✅ Recibieron
-- tu envío» **omitiendo justo lo que hay que ir a buscar**. Un aviso que
-- silencia el único hecho accionable es peor que ninguno.
--
-- ── Y por qué a veces NO avisa nada ────────────────────────────────────────
-- Cuando lo único que pasó es que no llegó, `avisar_faltantes` ya le escribió a
-- la sala de origen y a supervisión, con el nombre del producto y el enlace al
-- faltante. Un segundo aviso sobre el mismo hecho, con otro título, es ruido —y
-- el ruido es cómo una campana se deja de mirar. Se dice UNA vez, en el aviso
-- que sabe de qué habla.
CREATE OR REPLACE FUNCTION public.notificar_resolucion_envio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m        jsonb   := coalesce(NEW.metadata, '{}'::jsonb);
    v_org    integer := nullif(m->>'origen_branch_id', '')::integer;
    v_quien  text;
    v_ok     integer;
    v_no     integer;
    v_falta  integer;
    v_lista  text;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_PUSH' THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN RETURN NEW; END IF;
    IF v_org IS NULL THEN RETURN NEW; END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = NEW.approver_id;
    v_quien := coalesce(v_quien, coalesce(nullif(m->>'branch_name',''), 'La otra sala'));

    SELECT count(*) FILTER (WHERE estado = 'aceptada'),
           count(*) FILTER (WHERE estado IN ('devuelta','devuelta_recibida')),
           count(*) FILTER (WHERE estado = 'no_llego')
      INTO v_ok, v_no, v_falta
      FROM public.envio_linea WHERE request_id = NEW.id;

    -- Sólo faltantes: ya lo dijo `avisar_faltantes`, con el producto y el
    -- enlace. No se repite.
    IF coalesce(v_ok, 0) = 0 AND coalesce(v_no, 0) = 0 AND coalesce(v_falta, 0) > 0 THEN
        RETURN NEW;
    END IF;

    SELECT string_agg(coalesce(descripcion, 'el producto #' || erp_product_id)
                      || ' (' || coalesce(motivo_rechazo, 'sin motivo') || ')', '; ' ORDER BY posicion)
      INTO v_lista
      FROM public.envio_linea
     WHERE request_id = NEW.id AND estado IN ('devuelta','devuelta_recibida');

    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (e.id = NEW.employee_id
            OR (e.branch_id = v_org
                AND (public.rango_de_empleado(e.id) BETWEEN 1 AND 2
                     OR e.id IN (SELECT t.employee_id FROM public.empleados_en_turno(v_org) t))));
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN NEW; END IF;

    IF coalesce(v_no, 0) = 0 THEN
        v_titulo := '✅ Recibieron tu envío';
        v_cuerpo := v_quien || ' aceptó ' || v_ok
                 || CASE WHEN v_ok = 1 THEN ' producto' ELSE ' productos' END || ' de tu envío.';
    ELSE
        v_titulo := '↩️ Te devuelven producto';
        v_cuerpo := v_quien || ' devuelve ' || v_no
                 || CASE WHEN v_no = 1 THEN ' producto' ELSE ' productos' END
                 || CASE WHEN coalesce(v_ok,0) > 0 THEN ' y se queda con ' || v_ok ELSE '' END
                 || coalesce(': ' || v_lista, '')
                 || '. Confirma cuando la caja esté de vuelta en tu sala.';
    END IF;

    -- Lo que no llegó se agrega SIEMPRE al final, en las dos ramas: es el único
    -- dato del aviso que manda a alguien a mirar el mostrador hoy.
    IF coalesce(v_falta, 0) > 0 THEN
        v_cuerpo := v_cuerpo || ' Ojo: ' || v_falta
                 || CASE WHEN v_falta = 1 THEN ' producto no llegó en la caja.'
                         ELSE ' productos no llegaron en la caja.' END
                 || ' Revisa si quedó en tu sala.';
    END IF;

    v_link := '/traslados?tab=envios&envio=' || NEW.id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'resuelta', NEW.status),
           v_org, NEW.approver_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));

    RETURN NEW;
END;
$function$;
