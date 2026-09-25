SET lock_timeout = '5s';

-- El aviso de faltante decía «abrió la bolsa de Salud 3»: «bolsa» es el nombre
-- de la tabla (`bolsa_faltante`), no una palabra que la sala use — en pantalla
-- esto se llama TRASLADO. Reportado el 2026-09-25: «no se entiende qué es».
--
-- Y la tarjeta pinta `created_by · branch_id` como «persona · sala»: con
-- `branch_id` = origen, salía «Merlyn Lemus · Salud 3» sobre alguien de Salud 5.
-- La sala del aviso pasa a ser la de quien lo declaró (el destino, que es donde
-- se abrió la caja); la de origen sigue nombrada en el cuerpo.

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

    v_dest := public.destinatarios_de_faltante(nullif(m->>'origen_branch_id','')::integer, p_actor);
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

CREATE OR REPLACE FUNCTION public.avisar_faltantes_sin_resolver(p_dias integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r        record;
    v_dest   uuid[];
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dias   integer;
    v_n      integer := 0;
BEGIN
    FOR r IN
        SELECT bf.id, bf.request_id, bf.descripcion, bf.erp_product_id, bf.cantidad,
               bf.origen_branch_id, bf.recordado_dias,
               bo.name AS origen, bd.name AS destino,
               floor(extract(epoch FROM now() - bf.declarado_at) / 86400)::integer AS dias
          FROM public.bolsa_faltante bf
          LEFT JOIN public.branches bo ON bo.id = bf.origen_branch_id
          LEFT JOIN public.branches bd ON bd.id = bf.destino_branch_id
         WHERE bf.estado = 'abierto'
           AND bf.declarado_at < now() - make_interval(days => greatest(1, p_dias))
    LOOP
        v_dias := CASE WHEN r.dias >= 3 THEN 3 ELSE p_dias END;
        CONTINUE WHEN coalesce(r.recordado_dias, 0) >= v_dias;

        v_dest := public.destinatarios_de_faltante(r.origen_branch_id, NULL);
        CONTINUE WHEN coalesce(array_length(v_dest, 1), 0) = 0;

        v_titulo := '⚠️ Un faltante lleva ' || r.dias
                 || CASE WHEN r.dias = 1 THEN ' día sin resolver' ELSE ' días sin resolver' END;
        -- Se nombra el PRODUCTO y el recorrido, no el número del traslado: quien
        -- lo lee tiene que saber qué ir a buscar, que es lo único accionable.
        v_cuerpo := coalesce(r.descripcion, 'El producto #' || r.erp_product_id)
                 || ' — faltaron ' || trim(to_char(r.cantidad, 'FM999,999,990.####'))
                 || ' en el traslado de ' || coalesce(r.origen, 'una sala')
                 || ' a ' || coalesce(r.destino, 'otra sala')
                 || '. Si apareció, ciérralo; si no, di qué se hizo.';
        v_link := '/traslados?tab=faltantes&bolsa=' || r.request_id;

        -- Se anota ANTES de mandar: `pg_net` es transaccional, así que si algo de
        -- acá para abajo revienta, la anotación se va con él y el recordatorio se
        -- puede volver a intentar mañana.
        UPDATE public.bolsa_faltante SET recordado_dias = v_dias WHERE id = r.id;

        INSERT INTO public.notifications
            (recipient_id, type, title, body, link, metadata, branch_id, created_by)
        SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
               jsonb_build_object('request_id', r.request_id, 'faltante_id', r.id,
                                  'recordatorio', v_dias),
               r.origen_branch_id, NULL
          FROM unnest(v_dest) d;

        PERFORM net.http_post(
            url := public.push_function_url(), headers := public.push_function_headers(),
            body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                    'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$function$;

-- Los 9 avisos ya enviados (todos de un solo producto): mismo texto y sala nueva.
UPDATE public.notifications n
   SET title     = '⚠️ Faltó un producto en un traslado',
       body      = replace(replace(n.body, ' abrió la bolsa de ', ' recibió el traslado que mandó '),
                           ' y falta ', ' y no venía '),
       branch_id = coalesce(nullif(r.metadata->>'branch_id','')::integer, n.branch_id)
  FROM public.approval_requests r
 WHERE n.title = '⚠️ Faltó producto en una bolsa'
   AND r.id = (n.metadata->>'request_id')::uuid;
