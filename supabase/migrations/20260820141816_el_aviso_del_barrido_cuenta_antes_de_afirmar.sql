SET lock_timeout = '5s';

-- El aviso de las 8:00 decía lo que NO sabía (2026-08-20)
-- ============================================================================
-- «Las facturas anuladas sin invalidar y las que están sin sello siguen
-- esperando» era una afirmación fija, escrita a mano dentro del aviso. La
-- madrugada del 2026-08-20 no había NINGUNA esperando —0 sin sello, 0 anuladas
-- por invalidar— y el aviso la sostuvo igual, porque nunca miró.
--
-- Ahora lo cuenta antes de decirlo, con el MISMO criterio que usa el barrido
-- para armar su cola. Un aviso que afirma sin mirar es peor que uno que calla:
-- manda a buscar un atraso que no existe.
--
-- El conteo cuesta ~3 s (no hay índice sobre `recibido_mh`, así que barre la
-- tabla) y vive a propósito DENTRO de la rama de la alarma: en un día normal no
-- se ejecuta ni una vez. Pagar 3 s el día que algo está roto es barato; pagarlo
-- todos los días para adornar un aviso que no se manda, no.
--
-- Y se va la jerga de la tubería. El nombre de la función y el flag del
-- despliegue no son cosas del portal: quien recibe el aviso necesita saber QUÉ
-- quedó sin hacer, no cómo se llama el programa que lo hace. Esa trazabilidad
-- vive en los comentarios y en CLAUDE.md, que es donde sirve.
CREATE OR REPLACE FUNCTION public.alertar_barrido_dte()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_corrida    public.audit_logs%ROWTYPE;
    v_hubo       boolean;
    v_fallidas   int;
    v_resueltas  int;
    v_restantes  int;
    v_esperando  int;
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
        -- Las dos bolsas del barrido, contadas con su mismo criterio: anulada
        -- CON sello (hay algo que invalidar ante Hacienda) y no anulada SIN
        -- sello válido. El sello es texto de 40 caracteres, así que se compara
        -- por forma y no por «tiene algo» — ver la regla del tipo en CLAUDE.md.
        SELECT count(*) INTO v_esperando
          FROM public.sales_invoices
         WHERE (estado = 'NULA' AND recibido_mh LIKE repeat('_', 40))
            OR (estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
                AND (recibido_mh IS NULL OR recibido_mh NOT LIKE repeat('_', 40)));

        v_titulo := '🚨 El barrido de Hacienda no corrió anoche';
        v_cuerpo := 'No quedó registro de la corrida de las 22:30. '
                 || CASE WHEN v_esperando > 0
                         THEN 'Hay ' || v_esperando || ' factura'
                              || CASE WHEN v_esperando = 1 THEN '' ELSE 's' END
                              || ' esperando y no se van a mandar hasta que vuelva a correr. '
                         ELSE 'Ahora mismo no hay ninguna factura esperando, '
                              || 'pero tiene que volver a correr antes de que entre la próxima. '
                    END
                 || 'Hay que revisar el envío automático de las 22:30.';
    ELSE
        v_titulo := '⚠️ El barrido de Hacienda terminó con fallas';
        v_cuerpo := v_fallidas || ' factura' || CASE WHEN v_fallidas = 1 THEN '' ELSE 's' END
                 || ' no se pudo completar ante Hacienda'
                 || CASE WHEN v_resueltas > 0 THEN ', ' || v_resueltas || ' sí' ELSE '' END
                 || '. ' || CASE WHEN v_restantes > 0
                                 THEN 'Quedan ' || v_restantes || ' en cola. ' ELSE '' END
                 || 'Las que ya no se arreglan solas están en Facturación, en Observaciones.';
    END IF;

    PERFORM public.notify_employees(
        v_dest, 'SYSTEM', v_titulo, v_cuerpo, '/facturacion?tab=observaciones',
        jsonb_build_object('origen', 'regularizar-dte',
                           'corrida', v_corrida.id,
                           'fallidas', v_fallidas,
                           'esperando', v_esperando),
        true, NULL
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.alertar_barrido_dte() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.alertar_barrido_dte() TO service_role;
