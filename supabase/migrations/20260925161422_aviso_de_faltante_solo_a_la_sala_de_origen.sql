SET lock_timeout = '5s';

-- El aviso de faltante iba a la sala de origen Y a supervisión (rango ≥ 3). El
-- usuario, el 2026-09-25: supervisión sólo con el recordatorio. El aviso del
-- momento es para quien puede actuar — la sala que despachó —; que supervisión
-- lo sepa importa cuando nadie lo resolvió, y para eso ya está el recordatorio
-- de 1 y 3 días, que sigue usando `destinatarios_de_faltante` (sala + supervisión).

CREATE OR REPLACE FUNCTION public.avisar_faltantes(p_request_id uuid, p_ids uuid[], p_actor uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r        public.approval_requests%ROWTYPE;
    m        jsonb;
    v_n      integer;
    v_que    text;
    v_quien  text;
    v_sala   text;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
BEGIN
    SELECT * INTO r FROM public.approval_requests WHERE id = p_request_id;
    IF r.id IS NULL THEN RETURN 0; END IF;
    m := coalesce(r.metadata, '{}'::jsonb);

    SELECT count(*),
           CASE WHEN count(*) = 1
                THEN max(coalesce(bf.descripcion, 'el producto #' || bf.erp_product_id))
                ELSE NULL END
      INTO v_n, v_que
      FROM public.bolsa_faltante bf
     WHERE bf.id = ANY(p_ids);
    IF coalesce(v_n, 0) = 0 THEN RETURN 0; END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = p_actor;
    v_quien := coalesce(v_quien, 'La sala que recibió');
    v_sala  := coalesce(nullif(m->>'branch_name', ''), 'la otra sala');

    -- Sólo la sala que despachó: es la única que puede ir a buscarlo. Supervisión
    -- se entera por el recordatorio (`avisar_faltantes_sin_resolver`), cuando el
    -- faltante ya lleva un día abierto — decisión del usuario del 2026-09-25.
    SELECT array_agg(DISTINCT x) INTO v_dest
      FROM unnest((SELECT destinatarios
                     FROM public.resolver_destinatarios_traslado(
                              nullif(m->>'origen_branch_id','')::integer) LIMIT 1)) x
     WHERE x IS NOT NULL AND x <> p_actor;
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;

    v_titulo := CASE WHEN v_n = 1 THEN '⚠️ Faltó un producto en un traslado'
                     ELSE '⚠️ Faltaron productos en un traslado' END;
    v_cuerpo := v_quien || ' (' || v_sala || ') recibió el traslado que mandó '
             || coalesce(nullif(m->>'origen_branch_name',''), 'tu sala')
             || CASE WHEN v_n = 1 THEN ' y no venía ' ELSE ' y no venían ' END
             || coalesce(v_que, v_n || ' productos')
             || '. Revisa si quedó en tu sala y responde en Traslados.';

    v_link := '/traslados?tab=faltantes&bolsa=' || r.id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', r.id, 'request_type', r.type, 'faltantes', to_jsonb(p_ids)),
           -- La sala de quien firma, no la de origen: la tarjeta la pinta al lado
           -- de su nombre.
           coalesce(nullif(m->>'branch_id','')::integer,
                    nullif(m->>'origen_branch_id','')::integer),
           p_actor
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        body    := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                                      'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)));

    RETURN coalesce(array_length(v_dest, 1), 0);
END;
$function$;
