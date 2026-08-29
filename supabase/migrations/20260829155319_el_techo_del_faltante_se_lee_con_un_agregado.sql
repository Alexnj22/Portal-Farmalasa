SET lock_timeout = '5s';

-- El techo del faltante de una SOLICITUD reventaba, y no se veía leyendo el SQL.
--
-- La versión anterior de `declarar_faltantes` leía lo que viajó así:
--
--     SELECT d->>'cantidad' INTO v_techo
--       FROM jsonb_array_elements(…) d
--      WHERE … = v_prod
--     HAVING count(*) = 1;
--
-- `HAVING` sin `GROUP BY` convierte la consulta en agregada, y entonces
-- `d->>'cantidad'` **no está agrupada**. Postgres la rechaza con «column
-- "x.value" must appear in the GROUP BY clause or be used in an aggregate
-- function» — pero el cuerpo de una función `plpgsql` no se planifica al
-- crearla, así que la migración entró en verde y el error habría salido recién
-- con alguien declarando un faltante, con la caja en la mano.
--
-- Medido antes de corregir: la forma vieja falla; la nueva devuelve 2 con un
-- solo renglón del producto y NULL cuando se repite, que es exactamente lo que
-- la intención pedía.
--
-- El arreglo es envolver la columna en el agregado: `max((d->>'cantidad')::
-- numeric)`. El `HAVING count(*) = 1` se queda y sigue significando lo mismo —
-- con el mismo producto en dos renglones, el detalle no distingue cuál es cuál
-- y el techo vuelve a ser lo pedido.
CREATE OR REPLACE FUNCTION public.declarar_faltantes(
    p_request_id uuid,
    p_faltantes  jsonb,
    p_actor      uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    r          public.approval_requests%ROWTYPE;
    m          jsonb;
    v_familia  text;
    f          jsonb;
    v_pos      integer;
    v_cant     numeric;
    v_nota     text;
    v_prod     integer;
    v_desc     text;
    v_pres     text;
    v_techo    numeric;
    v_origen   integer;
    v_destino  integer;
    v_nuevos   integer := 0;
    v_ids      uuid[] := ARRAY[]::uuid[];
    v_id       uuid;
BEGIN
    SELECT * INTO r FROM public.approval_requests WHERE id = p_request_id;
    IF r.id IS NULL THEN
        RAISE EXCEPTION 'No existe la bolsa %.', p_request_id;
    END IF;

    -- La familia se DERIVA del tipo de la fila. Un parámetro podría decir
    -- «envío» apuntando a una solicitud y la lista quedaría mintiendo sobre
    -- dónde mirar.
    v_familia := CASE r.type
        WHEN 'INVENTORY_TRANSFER_REQUEST' THEN 'solicitud'
        WHEN 'INVENTORY_TRANSFER_PUSH'    THEN 'envio'
        ELSE NULL END;
    IF v_familia IS NULL THEN
        RAISE EXCEPTION 'La fila % no es un traslado entre salas.', p_request_id;
    END IF;

    m := coalesce(r.metadata, '{}'::jsonb);
    v_origen  := nullif(m->>'origen_branch_id', '')::integer;
    v_destino := nullif(m->>'branch_id', '')::integer;

    FOR f IN SELECT * FROM jsonb_array_elements(coalesce(p_faltantes, '[]'::jsonb))
    LOOP
        v_pos  := nullif(f->>'posicion', '')::integer;
        v_cant := nullif(f->>'cantidad', '')::numeric;
        v_nota := nullif(btrim(coalesce(f->>'nota', '')), '');

        -- Cero no es un faltante: es el renglón que llegó completo. Se saltea en
        -- vez de rebotar, para que la pantalla pueda mandar la lista entera y
        -- que decida el servidor cuáles son huecos de verdad.
        CONTINUE WHEN v_pos IS NULL OR v_cant IS NULL OR v_cant <= 0;

        v_prod := NULL; v_desc := NULL; v_pres := NULL; v_techo := NULL;

        IF v_familia = 'envio' THEN
            SELECT l.erp_product_id, l.descripcion, l.presentacion_tipo, l.cantidad
              INTO v_prod, v_desc, v_pres, v_techo
              FROM public.envio_linea l
             WHERE l.request_id = p_request_id AND l.posicion = v_pos;
        ELSE
            -- En la solicitud la posición es el ÍNDICE del renglón dentro de
            -- `metadata.items`, que es el mismo contrato que ya usa el despacho
            -- parcial (`lineas_aceptadas` viaja como `{i, cantidad}`). El
            -- navegador no elige qué producto se nombra: sólo señala cuál de
            -- los que ya están guardados faltó.
            SELECT nullif(it->>'erp_product_id','')::integer,
                   it->>'descripcion',
                   it->>'presentacion_tipo',
                   nullif(it->>'cantidad','')::numeric
              INTO v_prod, v_desc, v_pres, v_techo
              FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) WITH ORDINALITY AS a(it, n)
             WHERE a.n = v_pos + 1;

            -- Y si el despacho salió recortado, lo que manda es lo que VIAJÓ.
            -- El detalle guarda el producto pero NO la posición, así que se
            -- cruza por producto y sólo vale cuando aparece una vez.
            SELECT max((d->>'cantidad')::numeric) INTO v_techo
              FROM jsonb_array_elements(coalesce(m->'erp_traslado'->'detalle', '[]'::jsonb)) d
             WHERE nullif(d->>'erp_product_id','')::integer = v_prod
            HAVING count(*) = 1;

            IF v_techo IS NULL THEN
                SELECT nullif(it->>'cantidad','')::numeric INTO v_techo
                  FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) WITH ORDINALITY AS a(it, n)
                 WHERE a.n = v_pos + 1;
            END IF;
        END IF;

        -- Una posición que no existe es una pantalla desincronizada, no un
        -- faltante: se rebota entero para que nadie crea que quedó anotado.
        IF v_prod IS NULL AND v_desc IS NULL THEN
            RAISE EXCEPTION 'La bolsa % no tiene un producto en la posición %.', p_request_id, v_pos;
        END IF;

        IF v_techo IS NOT NULL AND v_techo > 0 AND v_cant > v_techo THEN
            RAISE EXCEPTION 'De % salieron %: no pueden faltar %.',
                coalesce(v_desc, 'ese producto'), v_techo, v_cant;
        END IF;

        INSERT INTO public.bolsa_faltante (
            request_id, familia, posicion, erp_product_id, descripcion, presentacion_tipo,
            cantidad, nota, origen_branch_id, destino_branch_id, declarado_por
        ) VALUES (
            p_request_id, v_familia, v_pos, v_prod, v_desc, v_pres,
            v_cant, v_nota, v_origen, v_destino, p_actor
        )
        -- Dos personas mirando la misma caja declaran el mismo hueco: la
        -- segunda no escribe y tampoco falla. El índice parcial es el que
        -- decide, no un `SELECT` previo que otra transacción puede pisar.
        ON CONFLICT (request_id, posicion) WHERE estado = 'abierto' DO NOTHING
        RETURNING id INTO v_id;

        IF v_id IS NOT NULL THEN
            v_nuevos := v_nuevos + 1;
            v_ids := v_ids || v_id;
            v_id := NULL;
        END IF;
    END LOOP;

    IF v_nuevos > 0 THEN
        PERFORM public.avisar_faltantes(p_request_id, v_ids, p_actor);
    END IF;

    RETURN json_build_object('ok', true, 'declarados', v_nuevos, 'ids', to_json(v_ids));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.declarar_faltantes(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.declarar_faltantes(uuid, jsonb, uuid) TO service_role;
