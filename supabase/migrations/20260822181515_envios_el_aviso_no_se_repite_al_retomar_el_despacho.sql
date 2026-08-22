SET lock_timeout = '5s';

-- Un despacho que se corta por tiempo se retoma apretando de nuevo, y al
-- terminar volvía a llamar al aviso: la sala de destino recibía DOS
-- notificaciones del mismo envío, la segunda contando también los productos que
-- ya le habíamos anunciado. No es un error de dato —las dos dicen la verdad del
-- momento— pero la segunda no trae nada nuevo, y un aviso que repite es un
-- aviso que se empieza a ignorar.
--
-- El freno es contar: se guarda cuántos renglones se anunciaron y sólo se
-- vuelve a avisar si salieron MÁS. Así el caso normal avisa una vez, el
-- despacho en dos tandas avisa dos veces diciendo cada una algo distinto, y
-- llamar a la función dos veces seguidas no avisa dos veces.

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
    v_ya     integer;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
BEGIN
    SELECT * INTO r FROM public.approval_requests WHERE id = p_request_id;
    IF r.id IS NULL OR r.type <> 'INVENTORY_TRANSFER_PUSH' THEN RETURN 0; END IF;

    m := coalesce(r.metadata, '{}'::jsonb);

    -- Sólo lo que de verdad salió. Un renglón que no se pudo despachar no se
    -- anuncia: la sala de destino no tiene nada que decidir sobre él.
    SELECT count(*), coalesce(sum(l.unidades), 0),
           CASE WHEN count(*) = 1 THEN max(coalesce(l.descripcion, 'el producto #' || l.erp_product_id))
                ELSE NULL END
      INTO v_n, v_unid, v_que
      FROM public.envio_linea l
     WHERE l.request_id = p_request_id AND l.estado = 'enviada';
    IF coalesce(v_n, 0) = 0 THEN RETURN 0; END IF;

    -- Cuántos se anunciaron ya. Igual o menos = no hay nada nuevo que decir.
    v_ya := coalesce((m->>'avisado_lineas')::integer, 0);
    IF v_n <= v_ya THEN RETURN 0; END IF;

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
    -- volver a intentar. Al revés —avisar y después anotar— un fallo dejaría el
    -- aviso mandado y el contador sin mover.
    UPDATE public.approval_requests
       SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('avisado_lineas', v_n)
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
