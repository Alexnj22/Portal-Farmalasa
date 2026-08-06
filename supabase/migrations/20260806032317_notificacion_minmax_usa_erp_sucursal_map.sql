-- El trigger buscaba el nombre de la sucursal en `branches.erp_id`, que no
-- existe. La tabla que sí mapea el id del ERP es `erp_sucursal_map`, y es la
-- fuente correcta: el frontend tiene su propia copia del mapa
-- (`views/productos/tabminmax/constants.js`, ERP_NAMES) y duplicarla en SQL
-- habría sido una tercera lista para desincronizarse.
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
        '/minmax?tab=solicitudes&solicitud=' || NEW.id,
        jsonb_build_object('request_id', NEW.id, 'request_type', 'MINMAX',
                           'producto', NEW.product_name),
        true, NULL
    );

    RETURN NEW;
END;
$$;
