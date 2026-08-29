SET lock_timeout = '5s';

-- Declarar un faltante DESPUÉS de haber recibido la bolsa, con plazo.
--
-- Hasta hoy se declaraba sólo al recibir, y el caso real es el otro: se aprieta
-- «ya llegó» y se cuenta diez minutos después. Sin esta puerta, quien contaba
-- después no tenía dónde decirlo y el hueco volvía a ser invisible — que es
-- exactamente lo que el circuito vino a cerrar.
--
-- ── Por qué CON plazo, y por qué 48 horas ─────────────────────────────────
-- Decisión del usuario. Un faltante se declara para que alguien vaya a BUSCAR
-- la caja: la sala de origen mira su mostrador, el que hizo el recorrido revisa
-- lo que lleva. Pasados unos días eso ya no se puede hacer y lo que queda es un
-- reclamo sin caja — un número que nadie puede confirmar ni desmentir, apuntado
-- contra una sala. 48 horas cubre el turno siguiente y el día después, que es
-- cuando el conteo de una sala llega a ese estante.
--
-- Lo que se descubra más tarde tiene su lugar y no es éste: el conteo cíclico.

-- ══════════════════════════════════════════════════════════════════════════
-- 1 · El techo baja a la base, para que los DOS caminos lo tengan
-- ══════════════════════════════════════════════════════════════════════════
--
-- `aplicar-traslado-inventario` ya comprobaba que no se declare más de lo que
-- viajó, y estaba bien: da el error antes de hacer trabajo. Pero era la ÚNICA
-- guarda, y el camino tardío no pasa por ahí — así que el techo se escribe
-- ADEMÁS acá, que es por donde entran los dos. Misma forma que la foto de la
-- avería: la pantalla lo pide y la base lo exige.
--
-- El detalle de lo despachado guarda `erp_product_id` pero **no la posición**,
-- así que se cruza por producto. Con el mismo producto en dos renglones
-- —presentaciones distintas— el detalle no distingue cuál es cuál y el techo
-- vuelve a ser lo pedido: preferible un techo flojo a rechazar un faltante
-- verdadero.
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
            SELECT d->>'cantidad' INTO v_techo
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

-- ══════════════════════════════════════════════════════════════════════════
-- 2 · La puerta tardía
-- ══════════════════════════════════════════════════════════════════════════
--
-- A diferencia de `declarar_faltantes`, ésta SÍ la llama el navegador — así que
-- la guarda vive acá y no en una Edge Function: quién firma sale de
-- `auth_employee_id()` y no de un parámetro, el permiso es el mismo que el de
-- recibir (`traslados.can_approve`), y la sala tiene que ser la de DESTINO, que
-- es la que tuvo la caja.
CREATE OR REPLACE FUNCTION public.declarar_faltante_tardio(
    p_request_id uuid,
    p_faltantes  jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    -- El plazo, en un solo sitio. Ver el encabezado.
    c_horas   constant integer := 48;
    r         public.approval_requests%ROWTYPE;
    m         jsonb;
    v_yo      uuid;
    v_sala    integer;
    v_cerrada timestamptz;
    v_horas   numeric;
BEGIN
    v_yo := public.auth_employee_id();
    IF v_yo IS NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: no se pudo resolver quién eres.';
    END IF;
    IF NOT public.auth_has_module_permission('traslados', 'can_approve') THEN
        RAISE EXCEPTION 'FORBIDDEN: no tienes permiso para recibir traslados.';
    END IF;

    SELECT * INTO r FROM public.approval_requests WHERE id = p_request_id;
    IF r.id IS NULL OR r.type NOT IN ('INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH') THEN
        RAISE EXCEPTION 'Esa bolsa no existe o no es un traslado entre salas.';
    END IF;
    m := coalesce(r.metadata, '{}'::jsonb);

    -- La sala de DESTINO, que es la que tuvo la caja enfrente. El alcance sobre
    -- todas las salas también entra: supervisión resuelve por las dos puntas.
    SELECT branch_id INTO v_sala FROM public.employees WHERE id = v_yo;
    IF NOT (public.auth_can_edit_scope_all(ARRAY['traslados'])
            OR v_sala IS NOT DISTINCT FROM nullif(m->>'branch_id','')::integer) THEN
        RAISE EXCEPTION 'FORBIDDEN: esto lo declara la sala que recibió la bolsa.';
    END IF;

    -- Cuándo se cerró la recepción. La solicitud lo guarda en el metadata; el
    -- envío no tiene un momento único —se decide renglón por renglón— así que
    -- es el ÚLTIMO, que es cuando se terminó de mirar la caja.
    IF r.type = 'INVENTORY_TRANSFER_REQUEST' THEN
        v_cerrada := nullif(m->'erp_recibido'->>'at', '')::timestamptz;
    ELSE
        SELECT max(l.decidido_at) INTO v_cerrada
          FROM public.envio_linea l
         WHERE l.request_id = p_request_id
           AND l.estado IN ('aceptada','devuelta','devuelta_recibida','no_llego');
    END IF;

    IF v_cerrada IS NULL THEN
        -- Todavía no se recibió: el camino normal sigue abierto y es el que
        -- corresponde. Decirlo así, y no «no se puede», es la diferencia entre
        -- mandar a alguien a la pantalla correcta o dejarlo trabado.
        RETURN json_build_object('ok', false, 'codigo', 'TODAVIA_NO_RECIBIDA',
            'error', 'Esta bolsa todavía no se recibió: dilo al recibirla.');
    END IF;

    v_horas := extract(epoch FROM now() - v_cerrada) / 3600;
    IF v_horas > c_horas THEN
        RETURN json_build_object('ok', false, 'codigo', 'FUERA_DE_PLAZO',
            'horas', round(v_horas),
            'error', 'Esta bolsa se recibió hace ' || round(v_horas / 24) || ' días. '
                  || 'Un faltante se declara dentro de las ' || c_horas || ' horas, mientras '
                  || 'todavía se puede ir a buscar la caja. Lo que aparezca después se '
                  || 'resuelve por conteo.');
    END IF;

    RETURN public.declarar_faltantes(p_request_id, p_faltantes, v_yo);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.declarar_faltante_tardio(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.declarar_faltante_tardio(uuid, jsonb) TO authenticated, service_role;
