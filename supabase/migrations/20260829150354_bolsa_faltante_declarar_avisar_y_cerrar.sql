SET lock_timeout = '5s';

-- Declarar, avisar y cerrar un faltante de bolsa.
--
-- Tres funciones y una regla que las ordena: **el que abre la caja declara, y
-- el que la despachó se entera en el acto.** Sin lo segundo, un faltante es una
-- fila que nadie mira; la sala de origen es la única que todavía puede ir a ver
-- si la bolsa quedó en su mostrador.

-- ══════════════════════════════════════════════════════════════════════════
-- 1 · Declarar
-- ══════════════════════════════════════════════════════════════════════════
--
-- Sólo `service_role`. Las dos pantallas que declaran —recibir una solicitud y
-- decidir un envío— pasan por sus Edge Functions, y **ahí ya está la guarda de
-- que quien declara es la sala de destino**: la que tiene la caja. Repetirla
-- acá sería tener dos reglas que se pueden desincronizar; abrirla a
-- `authenticated` sería tener CERO, porque esta función es DEFINER y escribe
-- con el nombre del actor que le pasan.
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

        v_prod := NULL; v_desc := NULL; v_pres := NULL;

        IF v_familia = 'envio' THEN
            SELECT l.erp_product_id, l.descripcion, l.presentacion_tipo
              INTO v_prod, v_desc, v_pres
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
                   it->>'presentacion_tipo'
              INTO v_prod, v_desc, v_pres
              FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) WITH ORDINALITY AS a(it, n)
             WHERE a.n = v_pos + 1;
        END IF;

        -- Una posición que no existe es una pantalla desincronizada, no un
        -- faltante: se rebota entero para que nadie crea que quedó anotado.
        IF v_prod IS NULL AND v_desc IS NULL THEN
            RAISE EXCEPTION 'La bolsa % no tiene un producto en la posición %.', p_request_id, v_pos;
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
-- 2 · Avisar a quien despachó
-- ══════════════════════════════════════════════════════════════════════════
--
-- A la sala de ORIGEN, que es la única que todavía puede ir a ver si la bolsa
-- se quedó en su mostrador, **y a supervisión siempre**: un faltante es una
-- diferencia de existencias entre dos salas y ninguna de las dos puede ser la
-- única que la sepa.
CREATE OR REPLACE FUNCTION public.avisar_faltantes(
    p_request_id uuid,
    p_ids        uuid[],
    p_actor      uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
    v_sala_o uuid[];
    v_sup    uuid[];
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

    SELECT destinatarios INTO v_sala_o
      FROM public.resolver_destinatarios_traslado(nullif(m->>'origen_branch_id','')::integer);

    SELECT array_agg(e.id ORDER BY e.name) INTO v_sup
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND public.rango_de_empleado(e.id) >= 3
       AND public.puede_confirmar_traslado(e.id);

    -- Quien acaba de declararlo no se avisa a sí mismo: acaba de escribirlo en
    -- pantalla.
    SELECT array_agg(DISTINCT x) INTO v_dest
      FROM unnest(coalesce(v_sala_o, ARRAY[]::uuid[]) || coalesce(v_sup, ARRAY[]::uuid[])) x
     WHERE x IS NOT NULL AND x <> p_actor;
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;

    v_titulo := '⚠️ Faltó producto en una bolsa';
    v_cuerpo := v_quien || ' (' || v_sala || ') abrió la bolsa de '
             || coalesce(nullif(m->>'origen_branch_name',''), 'tu sala')
             || ' y falta '
             || coalesce(v_que, v_n || ' ' || CASE WHEN v_n = 1 THEN 'producto' ELSE 'productos' END)
             || '. Revisa si quedó en tu sala y responde en Traslados.';

    v_link := '/traslados?tab=faltantes&bolsa=' || r.id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', r.id, 'request_type', r.type, 'faltantes', to_jsonb(p_ids)),
           nullif(m->>'origen_branch_id','')::integer, p_actor
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        body    := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                                      'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)));

    RETURN coalesce(array_length(v_dest, 1), 0);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_faltantes(uuid, uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_faltantes(uuid, uuid[], uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 3 · Cerrarlo
-- ══════════════════════════════════════════════════════════════════════════
--
-- Dos finales y nada más: **apareció** o **no apareció**. Ninguno de los dos
-- mueve existencias — cerrar el hecho y corregir el papel son dos actos
-- distintos, y mezclarlos haría que «ya lo revisé» descontara inventario sin
-- que nadie lo haya decidido.
--
-- Quién puede: el permiso de traslados manda, y la sala tiene que ser una de
-- las dos —o la persona, supervisión—. Un faltante de otra sala no se cierra
-- desde afuera: quien no estuvo no puede declarar que apareció.
CREATE OR REPLACE FUNCTION public.cerrar_faltante(
    p_id     uuid,
    p_estado text,
    p_nota   text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    bf      public.bolsa_faltante%ROWTYPE;
    v_yo    uuid;
    v_sala  integer;
    v_ok    boolean;
BEGIN
    IF p_estado NOT IN ('aparecio', 'no_aparecio') THEN
        RAISE EXCEPTION 'Un faltante se cierra en aparecio o no_aparecio, no en %.', p_estado;
    END IF;

    v_yo := public.auth_employee_id();
    IF v_yo IS NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: no se pudo resolver quién eres.';
    END IF;
    IF NOT public.auth_can_edit_any(ARRAY['traslados']) THEN
        RAISE EXCEPTION 'FORBIDDEN: no tienes permiso para resolver faltantes de traslado.';
    END IF;

    SELECT * INTO bf FROM public.bolsa_faltante WHERE id = p_id;
    IF bf.id IS NULL THEN
        RAISE EXCEPTION 'No existe ese faltante.';
    END IF;
    -- Ya cerrado: no se vuelve a cerrar ni se cambia el desenlace. Reabrirlo es
    -- una decisión de otra persona y otro momento; pisarlo acá borraría quién
    -- dijo qué.
    IF bf.estado <> 'abierto' THEN
        RETURN json_build_object('ok', false, 'codigo', 'YA_CERRADO', 'estado', bf.estado);
    END IF;

    SELECT branch_id INTO v_sala FROM public.employees WHERE id = v_yo;
    IF NOT (
        public.auth_es_supervision()
        OR public.auth_can_edit_scope_all(ARRAY['traslados'])
        OR v_sala IS NOT DISTINCT FROM bf.origen_branch_id
        OR v_sala IS NOT DISTINCT FROM bf.destino_branch_id
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN: este faltante lo resuelven las salas que lo vivieron.';
    END IF;

    -- «No apareció» sin una palabra es el cierre que no dice nada, y es
    -- justamente el que alguien va a tener que leer dentro de un mes.
    IF p_estado = 'no_aparecio' AND nullif(btrim(coalesce(p_nota, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Para cerrarlo como no aparecido hay que escribir qué se hizo.';
    END IF;

    UPDATE public.bolsa_faltante
       SET estado      = p_estado,
           resolucion  = nullif(btrim(coalesce(p_nota, '')), ''),
           resuelto_por = v_yo,
           resuelto_at = now()
     WHERE id = p_id AND estado = 'abierto'
    RETURNING true INTO v_ok;

    RETURN json_build_object('ok', coalesce(v_ok, false), 'estado', p_estado);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cerrar_faltante(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cerrar_faltante(uuid, text, text) TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 4 · La lista
-- ══════════════════════════════════════════════════════════════════════════
--
-- INVOKER: el RLS de `bolsa_faltante` —que se apoya en el de
-- `approval_requests`— es el que decide qué salas ve cada quien, igual que
-- `get_traslados_por_recibir`.
--
-- Sin parámetros a propósito. Una función `LANGUAGE sql` CON `SET search_path`
-- y parámetros nace con plan genérico y no hay plan personalizado que pedir
-- (regla 4 de CLAUDE.md); sin parámetros esa trampa no existe. Y la lista que
-- una pantalla necesita es siempre la misma: todo lo abierto, más lo cerrado
-- del último mes para poder mirar atrás sin ir al historial.
CREATE OR REPLACE FUNCTION public.get_faltantes_de_bolsa()
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.declarado_at DESC), '[]'::json)
    FROM (
      SELECT bf.id, bf.request_id, bf.familia, bf.posicion,
             bf.erp_product_id, bf.descripcion, bf.presentacion_tipo,
             bf.cantidad, bf.nota, bf.estado, bf.resolucion,
             bf.declarado_at, bf.resuelto_at,
             bf.origen_branch_id, bf.destino_branch_id,
             bo.name AS origen_branch_name,
             bd.name AS destino_branch_name,
             ed.name AS declarado_por_nombre,
             er.name AS resuelto_por_nombre,
             r.metadata->>'codigo_bolsa'                  AS codigo_bolsa,
             r.metadata->'erp_traslado'->>'id_traslado'   AS id_traslado,
             coalesce(r.metadata->>'motivo_tipo', '')     AS motivo_tipo
        FROM public.bolsa_faltante bf
        LEFT JOIN public.approval_requests r ON r.id = bf.request_id
        LEFT JOIN public.branches  bo ON bo.id = bf.origen_branch_id
        LEFT JOIN public.branches  bd ON bd.id = bf.destino_branch_id
        LEFT JOIN public.employees ed ON ed.id = bf.declarado_por
        LEFT JOIN public.employees er ON er.id = bf.resuelto_por
       WHERE bf.estado = 'abierto'
          OR bf.resuelto_at > now() - interval '30 days'
    ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_faltantes_de_bolsa() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_faltantes_de_bolsa() TO authenticated, service_role;
