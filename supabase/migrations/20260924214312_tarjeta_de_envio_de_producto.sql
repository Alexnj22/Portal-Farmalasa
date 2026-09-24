SET lock_timeout = '5s';

-- El aviso de un envío que llega a la sala (el más frecuente del portal, ~90
-- al día) pasa a tarjeta (usuario, 24-sep): quién lo envía, cada producto con
-- sus unidades y el motivo. Título «Salud 5 te envía producto», sin emoji.

CREATE OR REPLACE FUNCTION public.notificar_envio_despachado(p_request_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
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
    -- La tarjeta de la campana (24-sep).
    v_nombre text;
    v_prods  jsonb;
    v_sol    jsonb;
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

    SELECT name INTO v_nombre FROM public.employees WHERE id = r.employee_id;
    v_quien := coalesce(v_nombre, 'Otra sala');

    -- La sala que envía va en el título, sin emoji (24-sep): el color y el
    -- ícono los pone la tarjeta.
    v_titulo := coalesce(nullif(m->>'origen_branch_name', ''), 'Otra sala') || ' te envía producto';
    v_cuerpo := v_quien || ' (' || coalesce(nullif(m->>'origen_branch_name',''), 'otra sala') || ') te envía '
             || trim(to_char(v_unid, 'FM999,999,990.####'))
             || CASE WHEN v_unid = 1 THEN ' unidad' ELSE ' unidades' END
             || coalesce(' de ' || v_que,
                         ' de ' || v_n || CASE WHEN v_n = 1 THEN ' producto' ELSE ' productos' END)
             || ' — ' || coalesce(m->>'motivo_tipo', 'sin motivo')
             || coalesce(': ' || left(nullif(btrim(coalesce(m->>'reason', r.note, '')), ''), 120), '')
             || '. Revisa la caja y acepta o devuelve lo que no vayas a vender.';

    v_link := '/traslados?tab=envios&envio=' || r.id;

    /* Lo que dibuja la tarjeta (usuario, 24-sep): quién lo envía con su cara,
     * cada producto que espera respuesta con cuántas unidades, y el motivo.
     * Es la misma tarjeta de las solicitudes (`metadata.solicitud`). */
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'nombre',   coalesce(l.descripcion, 'Producto #' || l.erp_product_id),
               'cantidad', l.unidades)) ORDER BY l.posicion)
      INTO v_prods
      FROM (SELECT * FROM public.envio_linea
             WHERE request_id = p_request_id AND estado = 'enviada'
             ORDER BY posicion LIMIT 15) l;

    v_sol := jsonb_strip_nulls(jsonb_build_object(
        'tipo',       'INVENTORY_TRANSFER_PUSH',
        'etiqueta',   'Envío de producto',
        'quien',      v_nombre,
        'quien_id',   r.employee_id,
        'quien_foto', public.foto_de_empleado(r.employee_id),
        'sala',       nullif(m->>'origen_branch_name', ''),
        'productos',  v_prods,
        'mas',        nullif(greatest(v_n - 15, 0), 0),
        'unidades',   v_unid,
        'motivo',     nullif(concat_ws(': ', nullif(m->>'motivo_tipo', ''),
                              left(nullif(btrim(coalesce(m->>'reason', r.note, '')), ''), 160)), '')));

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
           jsonb_build_object('request_id', r.id, 'request_type', r.type, 'solicitud', v_sol),
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
