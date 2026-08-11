SET lock_timeout = '5s';

-- La pestaña a la que apuntaba este aviso ya no existe (2026-08-10).
--
-- `notificar_solicitud_minmax` enlazaba a `/minmax?tab=solicitudes&solicitud=N`,
-- y esa pestaña se quitó al unificar el centro (decisión del usuario: «quita el
-- de min y max, lo siento innecesario»). Sin este cambio, cada aviso de un
-- ajuste pendiente llevaría a una pantalla donde esa pestaña ya no está: el
-- enlace no daría error, simplemente abriría Min/Max en otra pestaña y quien lo
-- tocara no encontraría la solicitud. El peor tipo de enlace roto — el que
-- parece que funcionó.
--
-- El id del centro lleva prefijo `minmax:` porque ahí conviven dos numeraciones:
-- los uuid de `approval_requests` y los bigint de esta tabla. Sin el prefijo, el
-- `?solicitud=26` de un ajuste podría, el día de mañana, chocar con otra cosa.
-- Es la misma regla del id sin su numeración que ya mordió con el ERP.
--
-- Se reescribe la función entera porque `CREATE OR REPLACE` no admite parches;
-- lo único que cambia es la línea del enlace.

CREATE OR REPLACE FUNCTION public.notificar_solicitud_minmax()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dest    uuid[];
    v_suc     text;
    v_cuerpo  text;
BEGIN
    IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

    v_dest := public.get_minmax_approver_ids();
    IF v_dest IS NULL OR array_length(v_dest, 1) IS NULL THEN
        INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
        VALUES ('MINMAX_SIN_APROBADOR', NEW.id::text, 'Sistema', 'SYSTEM', 'WARNING',
                jsonb_build_object('producto', NEW.product_name,
                                   'motivo', 'get_minmax_approver_ids() no devolvió a nadie'));
        RETURN NEW;
    END IF;

    SELECT nombre INTO v_suc
      FROM public.erp_sucursal_map
     WHERE erp_sucursal_id = NEW.erp_sucursal_id;

    v_cuerpo := coalesce(NEW.requested_by_name, 'Un empleado')
             || ' propone MIN ' || NEW.requested_min || ' · MAX ' || NEW.requested_max
             || ' para ' || coalesce(NEW.product_name, 'un producto')
             || coalesce(' (' || v_suc || ')', '')
             || '. Hoy está en MIN ' || coalesce(NEW.current_min::text, '—')
             || ' · MAX ' || coalesce(NEW.current_max::text, '—')
             || coalesce(' — ' || left(nullif(btrim(NEW.reason), ''), 140), '');

    PERFORM public.notify_employees(
        v_dest, 'MINMAX_PENDING', '📊 Solicitud de ajuste Min/Max', v_cuerpo,
        '/requests?solicitud=minmax:' || NEW.id,
        jsonb_build_object('request_id', NEW.id, 'request_type', 'MINMAX',
                           'producto', NEW.product_name),
        true, NULL
    );

    RETURN NEW;
END;
$function$;

-- El sub-permiso de la pestaña que ya no existe. Se apaga en vez de borrarse:
-- la fila es historia de quién lo tuvo, y el registro del frontend ya no lo
-- declara, así que ninguna pantalla vuelve a consultarlo.
UPDATE public.role_permissions
SET can_view = false, can_edit = false, can_approve = false
WHERE module_key = 'minmax_tab_solicitudes';
