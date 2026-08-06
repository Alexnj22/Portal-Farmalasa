-- El aviso de una solicitud de MIN/MAX lo mandaba el navegador, después del
-- insert y dentro de un `try {} catch { /* no-fatal */ }`. Resultado medido el
-- 2026-08-06: **cero** notificaciones `MINMAX_PENDING` en toda la historia de
-- la tabla, con tres solicitudes creadas. El canal nunca entregó nada.
--
-- Mismo arreglo que en `approval_requests`: la notificación pasa a ser parte de
-- crear la solicitud. Solicitud creada ⟹ aprobador avisado.
--
-- Se conserva la exclusión del propio solicitante que hace `notify_employees`
-- (`e.id <> auth_employee_id()`): cuando quien pide es el mismo que aprueba
-- —pasa, porque el aprobador es el Supervisor de Ventas— avisarle de su propia
-- solicitud es ruido. Lo que estaba mal no era eso, era que tampoco llegara
-- cuando el solicitante era otra persona.
--
-- El cuerpo lleva el producto, la sucursal, el de→a y el motivo: lo que hace
-- falta para decidir sin abrir la app.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.notificar_solicitud_minmax()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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

    SELECT name INTO v_suc FROM public.branches WHERE erp_id = NEW.erp_sucursal_id;

    v_cuerpo := coalesce(NEW.requested_by_name, 'Un empleado')
             || ' propone MIN ' || NEW.requested_min || ' · MAX ' || NEW.requested_max
             || ' para ' || coalesce(NEW.product_name, 'un producto')
             || coalesce(' (' || v_suc || ')', '')
             || '. Hoy está en MIN ' || coalesce(NEW.current_min::text, '—')
             || ' · MAX ' || coalesce(NEW.current_max::text, '—')
             || coalesce(' — ' || left(nullif(btrim(NEW.reason), ''), 140), '');

    PERFORM public.notify_employees(
        v_dest, 'MINMAX_PENDING', '📊 Solicitud de ajuste Min/Max', v_cuerpo,
        '/minmax?tab=solicitudes&solicitud=' || NEW.id,
        jsonb_build_object('request_id', NEW.id, 'request_type', 'MINMAX',
                           'producto', NEW.product_name),
        true, NULL
    );

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notificar_solicitud_minmax() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.notificar_solicitud_minmax() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_notificar_solicitud_minmax ON public.minmax_change_requests;
CREATE TRIGGER trg_notificar_solicitud_minmax
    AFTER INSERT ON public.minmax_change_requests
    FOR EACH ROW EXECUTE FUNCTION public.notificar_solicitud_minmax();

-- Y la contraparte: al decidirse, el aviso deja de ser accionable.
CREATE OR REPLACE FUNCTION public.marcar_notificacion_minmax_resuelta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF NEW.status = OLD.status OR NEW.status = 'pending' THEN RETURN NEW; END IF;

    UPDATE public.notifications
       SET metadata = coalesce(metadata, '{}'::jsonb)
                      || jsonb_build_object('resuelta', upper(NEW.status)),
           read_at  = coalesce(read_at, now())
     WHERE type = 'MINMAX_PENDING'
       AND metadata->>'request_id' = NEW.id::text;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.marcar_notificacion_minmax_resuelta() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.marcar_notificacion_minmax_resuelta() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_marcar_notificacion_minmax_resuelta ON public.minmax_change_requests;
CREATE TRIGGER trg_marcar_notificacion_minmax_resuelta
    AFTER UPDATE OF status ON public.minmax_change_requests
    FOR EACH ROW EXECUTE FUNCTION public.marcar_notificacion_minmax_resuelta();
