-- La alerta decía «3 facturas no se pudo completar». El singular estaba clavado
-- en el verbo y solo concordaba cuando fallaba una.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.alertar_barrido_dte()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_corrida    public.audit_logs%ROWTYPE;
    v_hubo       boolean;
    v_fallidas   int;
    v_resueltas  int;
    v_restantes  int;
    v_dest       uuid[];
    v_titulo     text;
    v_cuerpo     text;
BEGIN
    SELECT * INTO v_corrida
      FROM public.audit_logs
     WHERE action = 'DTE_REGULARIZADO'
       AND source = 'SYSTEM'
       AND created_at >= now() - interval '12 hours'
     ORDER BY created_at DESC
     LIMIT 1;

    v_hubo := FOUND;

    IF v_hubo THEN
        v_fallidas  := coalesce((v_corrida.details->>'fallidas')::int, 0);
        v_resueltas := coalesce((v_corrida.details->>'resueltas')::int, 0);
        v_restantes := coalesce((v_corrida.details->>'restantes')::int, 0);
        IF v_fallidas = 0 THEN RETURN; END IF;
    END IF;

    SELECT array_agg(e.id) INTO v_dest
      FROM public.employees e
      JOIN public.roles r ON r.name = 'Sistema — Alertas Técnicas'
     WHERE e.status = 'ACTIVO'
       AND (e.role_id = r.id OR e.secondary_role_id = r.id);

    IF v_dest IS NULL OR array_length(v_dest, 1) IS NULL THEN
        INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
        VALUES ('ALERTA_BARRIDO_DTE_SIN_DESTINATARIOS', 'regularizar-dte',
                'Vigilante', 'SYSTEM', 'CRITICAL',
                jsonb_build_object('motivo', 'nadie tiene el rol Sistema — Alertas Técnicas'));
        RETURN;
    END IF;

    IF NOT v_hubo THEN
        v_titulo := '🚨 El barrido de Hacienda no corrió anoche';
        v_cuerpo := 'No quedó registro de la corrida de las 22:30. '
                 || 'Las facturas anuladas sin invalidar y las que están sin sello siguen esperando. '
                 || 'Revisá que la función `regularizar-dte` siga desplegada con --no-verify-jwt.';
    ELSE
        v_titulo := '⚠️ El barrido de Hacienda terminó con fallas';
        v_cuerpo := CASE
                      WHEN v_fallidas = 1 THEN '1 factura no se pudo completar ante Hacienda'
                      ELSE v_fallidas || ' facturas no se pudieron completar ante Hacienda'
                    END
                 || CASE WHEN v_resueltas = 1 THEN '; 1 sí'
                         WHEN v_resueltas > 1 THEN '; ' || v_resueltas || ' sí'
                         ELSE '' END
                 || '. ' || CASE WHEN v_restantes > 0
                                 THEN 'Quedan ' || v_restantes || ' en cola. ' ELSE '' END
                 || 'El detalle de cada una está en la bitácora.';
    END IF;

    PERFORM public.notify_employees(
        v_dest, 'SYSTEM', v_titulo, v_cuerpo, '/audit',
        jsonb_build_object('origen', 'regularizar-dte',
                           'corrida', v_corrida.id,
                           'fallidas', v_fallidas),
        true, NULL
    );
END;
$$;
