SET lock_timeout = '5s';

-- ── El freno contra el aviso repetido estaba contando la columna equivocada ──
--
-- Contaba los renglones en estado `enviada`, o sea los que TODAVÍA esperan
-- decisión, y los comparaba contra lo ya anunciado. Basta con que la sala de
-- destino conteste rápido para que el número BAJE, y entonces el aviso de la
-- segunda tanda no sale:
--
--   envío de 3 · salen 2      → avisa, avisado_lineas = 2
--   destino acepta esas 2     → quedan 0 en `enviada`
--   se retoma y sale la 3ª    → count(enviada) = 1, y 1 <= 2 → NO avisa
--
-- La sala de destino nunca se entera de la tercera caja: llega producto que
-- nadie le anunció, y el envío se queda `PENDING` esperando una decisión que no
-- va a tomar porque no sabe que hay algo que decidir.
--
-- Lo que hay que contar es lo que SALIÓ alguna vez —`enviado_at`—, que sólo
-- crece. El texto del aviso sigue hablando de lo que está esperando decisión,
-- que es lo que hay que ir a mirar.
CREATE OR REPLACE FUNCTION public.notificar_envio_despachado(p_request_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r        public.approval_requests%ROWTYPE;
    m        jsonb;
    v_quien  text;
    v_n      integer;
    v_unid   numeric;
    v_que    text;
    v_salidas integer;
    v_ya     integer;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
BEGIN
    SELECT * INTO r FROM public.approval_requests WHERE id = p_request_id;
    IF r.id IS NULL OR r.type <> 'INVENTORY_TRANSFER_PUSH' THEN RETURN 0; END IF;

    m := coalesce(r.metadata, '{}'::jsonb);

    -- Cuántos salieron ALGUNA VEZ. Este número sólo crece, así que sirve de
    -- marca de agua contra lo ya anunciado.
    SELECT count(*) INTO v_salidas
      FROM public.envio_linea l
     WHERE l.request_id = p_request_id AND l.enviado_at IS NOT NULL;

    v_ya := coalesce((m->>'avisado_lineas')::integer, 0);
    IF coalesce(v_salidas, 0) <= v_ya THEN RETURN 0; END IF;

    -- Y de ésos, los que esperan que la sala de destino los mire: es de lo que
    -- habla el aviso. Sin ninguno no hay nada que anunciar —salió y ya se
    -- decidió— pero la marca se sube igual, para no anunciarlo más tarde.
    SELECT count(*), coalesce(sum(l.unidades), 0),
           CASE WHEN count(*) = 1 THEN max(coalesce(l.descripcion, 'el producto #' || l.erp_product_id))
                ELSE NULL END
      INTO v_n, v_unid, v_que
      FROM public.envio_linea l
     WHERE l.request_id = p_request_id AND l.estado = 'enviada';

    IF coalesce(v_n, 0) = 0 THEN
        UPDATE public.approval_requests
           SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('avisado_lineas', v_salidas)
         WHERE id = p_request_id;
        RETURN 0;
    END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = r.employee_id;
    v_quien := coalesce(v_quien, 'Otra sala');

    v_titulo := '📦 Te enviaron producto';
    v_cuerpo := v_quien || ' (' || coalesce(nullif(m->>'origen_branch_name',''), 'otra sala') || ') te envía '
             || trim(to_char(v_unid, 'FM999,999,990.####'))
             || CASE WHEN v_unid = 1 THEN ' unidad' ELSE ' unidades' END
             || coalesce(' de ' || v_que,
                         ' de ' || v_n || CASE WHEN v_n = 1 THEN ' producto' ELSE ' productos' END)
             || ' — ' || coalesce(m->>'motivo_tipo', 'sin motivo')
             || coalesce(': ' || left(nullif(btrim(coalesce(m->>'reason', r.note, '')), ''), 120), '')
             || '. Revisa la caja y acepta o devuelve lo que no vayas a vender.';

    v_link := '/traslados?tab=envios&envio=' || r.id;

    SELECT coalesce(
             (SELECT array_agg((d)::uuid) FROM jsonb_array_elements_text(m->'destinatarios') d),
             ARRAY[r.approver_id]) INTO v_dest;
    v_dest := (SELECT array_agg(DISTINCT x) FROM unnest(v_dest) x WHERE x IS NOT NULL AND x <> r.employee_id);
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;

    -- Se anota ANTES de mandar: `pg_net` es transaccional, así que si algo de
    -- acá para abajo revienta, la anotación se va con él y el aviso se puede
    -- volver a intentar.
    UPDATE public.approval_requests
       SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('avisado_lineas', v_salidas)
     WHERE id = p_request_id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', r.id, 'request_type', r.type),
           nullif(m->>'branch_id','')::integer, r.employee_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        body    := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                                      'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));

    RETURN coalesce(array_length(v_dest, 1), 0);
END;
$function$;
