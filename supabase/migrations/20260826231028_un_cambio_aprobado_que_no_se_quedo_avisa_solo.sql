-- Un cambio aprobado que no se quedó avisa solo.
--
-- El 2026-08-26 una venta de Salud 2 (0000065840_COF) se aprobó para pasar de
-- tarjeta a efectivo. El portal dijo «listo» sobre un cambio que nunca ocurrió,
-- y quien se enteró fue una persona, tres horas después, mirando el sistema a
-- mano. La causa de ESE caso quedó cerrada en v2.794.3 —una pantalla vacía se
-- leía como «efectivo» y la comprobación la daba por buena—, pero el modo de
-- falla es más ancho: el sistema puede revertir un dato por su cuenta. Pasó con
-- el crédito de 0000056702_COF, que volvió a tarjeta **cinco minutos** después
-- de aplicarse, dentro de la ventana en que el portal ya había confirmado.
--
-- Se compara contra el PORTAL, no contra el sistema: desde v2.794.0 el sync
-- trae de vuelta cualquier dato que cambie, así que si el portal sigue diciendo
-- lo de antes, el cambio no está.
--
-- Sólo vendedor y forma de pago, que son valores exactos. El cliente se guarda
-- como NOMBRE y compararlo por texto inventaría alarmas — y un aviso que se
-- equivoca se termina apagando.
--
-- Y sólo ventas del mes en curso, que son las que el repaso de cada hora vuelve
-- a leer. Sobre una más vieja el portal no tiene cómo enterarse, y avisar de
-- algo que no se pudo medir es peor que callarse.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.avisar_cambios_que_no_se_quedaron(p_horas integer DEFAULT 2)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    r         record;
    v_dest    uuid[];
    v_titulo  text;
    v_cuerpo  text;
    v_link    text;
    v_esperado text;
    v_actual   text;
    v_que      text;
    v_n       integer := 0;
BEGIN
    FOR r IN
        SELECT ar.id, ar.type, ar.employee_id, ar.approver_id,
               ar.metadata->'erp_aplicado'->>'campo' AS campo,
               ar.metadata->'erp_aplicado'->>'a'     AS aplicado,
               si.correlativo, si.cod_vendedor, si.tipo_pago, si.fecha,
               b.name AS sala
          FROM public.approval_requests ar
          JOIN public.sales_invoices si
            ON si.id = (ar.metadata->>'invoice_id')::bigint
          LEFT JOIN public.branches b ON b.id = si.branch_id
         WHERE ar.status = 'APPROVED'
           AND ar.metadata ? 'erp_aplicado'
           AND ar.metadata->'erp_aplicado'->>'campo' IN ('cod_vendedor', 'tipo_pago')
           AND coalesce((ar.metadata->>'avisado_no_se_quedo')::boolean, false) = false
           AND (ar.metadata->'erp_aplicado'->>'at')::timestamptz
                 < now() - make_interval(hours => greatest(1, p_horas))
           -- Una venta anulada ya no discute su forma de pago.
           AND upper(coalesce(si.estado, '')) NOT IN ('NULA', 'DTE INVALIDADO EN MH')
           AND si.fecha >= date_trunc('month',
                             (now() AT TIME ZONE 'America/El_Salvador'))::date
    LOOP
        IF r.campo = 'cod_vendedor' THEN
            v_esperado := btrim(coalesce(r.aplicado, ''));
            v_actual   := btrim(coalesce(r.cod_vendedor, ''));
            v_que      := 'el vendedor';
        ELSE
            v_esperado := lower(btrim(coalesce(r.aplicado, '')));
            v_actual   := lower(btrim(coalesce(r.tipo_pago, '')));
            v_que      := 'la forma de pago';
        END IF;

        CONTINUE WHEN v_esperado = '';        -- sin destino guardado no hay contra qué comparar
        CONTINUE WHEN v_actual = v_esperado;  -- se quedó: nada que avisar

        -- A quien lo confirmó, que es quien vio el «listo». Si no quedó
        -- registrado, a quien lo pidió.
        v_dest := (SELECT array_agg(DISTINCT x) FROM unnest(
                     ARRAY[r.approver_id, r.employee_id]) x WHERE x IS NOT NULL);
        v_dest := coalesce(v_dest, ARRAY[]::uuid[]);
        CONTINUE WHEN coalesce(array_length(v_dest, 1), 0) = 0;

        v_titulo := '⚠️ Un cambio de venta no se quedó';
        v_cuerpo := 'La venta ' || coalesce(r.correlativo, 'sin número')
                 || ' de ' || coalesce(r.sala, 'una sala')
                 || ' se cambió a «' || v_esperado || '», pero hoy vuelve a decir «'
                 || coalesce(nullif(v_actual, ''), 'nada') || '». '
                 || 'El cambio de ' || v_que || ' no se quedó: hay que revisarla.';
        v_link := CASE WHEN public.es_solicitud_operativa(r.type)
                       THEN '/requests' ELSE '/requests-personales' END
               || '?solicitud=' || r.id;

        INSERT INTO public.notifications
            (recipient_id, type, title, body, link, metadata, created_by)
        SELECT d, 'REQUEST_DECIDED', v_titulo, v_cuerpo, v_link,
               jsonb_build_object('request_id', r.id, 'request_type', r.type,
                                  'campo', r.campo, 'esperado', v_esperado,
                                  'en_el_portal', v_actual),
               r.employee_id
          FROM unnest(v_dest) d;

        UPDATE public.approval_requests
           SET metadata = coalesce(metadata, '{}'::jsonb)
                          || jsonb_build_object('avisado_no_se_quedo', true)
         WHERE id = r.id;

        PERFORM net.http_post(
            url     := public.push_function_url(),
            headers := public.push_function_headers(),
            body    := jsonb_build_object('title', v_titulo, 'message', v_cuerpo,
                                          'url', v_link, 'target_type', 'EMPLOYEE',
                                          'target_value', to_jsonb(v_dest)));
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.avisar_cambios_que_no_se_quedaron(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.avisar_cambios_que_no_se_quedaron(integer) TO service_role;

-- A los :20, después del repaso del mes que corre a las en punto. Antes de él
-- no hay dato nuevo con qué comparar y el aviso sería sobre una lectura vieja.
SELECT cron.schedule(
  'avisar-cambios-que-no-se-quedaron',
  '20 12-23,0-5 * * *',
  $cron$ SELECT public.avisar_cambios_que_no_se_quedaron(2); $cron$
);
