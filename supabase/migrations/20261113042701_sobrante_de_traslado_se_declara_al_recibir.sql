-- Sobrante de traslado: «vino de más» se declara al recibir (2026-11-12).
--
-- Decisión del usuario tras la auditoría de traslados del 2026-11-12, punto 5:
-- si en la bolsa viene producto DE MÁS, la sala que recibe lo declara y el
-- sistema se lo quita a la sala de origen, se lo suma a la que recibió y le
-- avisa al origen — como el sobrante del pedido semanal.
--
-- Hasta hoy no había dónde decirlo: la sala recibía lo que decía el traslado y
-- las unidades de más quedaban en su estante sin estar en su inventario, y en
-- el inventario de la sala de origen sin estar en su estante.
--
-- ── Cómo se mueve: es un ENVÍO, armado por la base ────────────────────────
-- Mover N unidades de una sala a otra ya tiene un circuito probado contra la
-- caja: el envío (`enviar-producto-erp`, un movimiento por renglón, con
-- candado, clave en el concepto y retoma por cron). El sobrante es exactamente
-- eso con el producto ya del otro lado, así que no se escribe un tercer camino:
-- `declarar_sobrantes` arma un envío marcado `sobrante_de`, la pantalla de
-- quien recibió lo despacha y lo acepta enseguida, y si se corta, el cron de
-- envíos lo despacha y queda en la lista de la sala para aceptarlo.
--
-- Ese envío no pasa por las reglas de `validar_envio_producto` (motivo de la
-- lista, «sólo desde tu propia sala», dirección): las arma quien recibió, no
-- quien envía, y nadie eligió mandarlo. Las salta SÓLO si lo inserta
-- `declarar_sobrantes`, que deja su marca en la transacción
-- (`portal.sobrante_de`); un insert directo con `sobrante_de` rebota.
SET lock_timeout = '5s';

-- ── El aviso al origen ────────────────────────────────────────────────────
-- Lo dispara `notificar_resolucion_envio` cuando el envío del sobrante cierra:
-- recién ahí la existencia se movió de verdad. A la sala de origen y a
-- supervisión (`destinatarios_de_faltante`, la misma lista que el faltante).
CREATE OR REPLACE FUNCTION public.avisar_sobrante(p_envio uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r        public.approval_requests%ROWTYPE;
    m        jsonb;
    v_org    integer;
    v_dest   uuid[];
    v_lista  text;
    v_n      integer;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_sala   text;
    v_osala  text;
    v_bolsa  text;
BEGIN
    SELECT * INTO r FROM public.approval_requests WHERE id = p_envio;
    m := coalesce(r.metadata, '{}'::jsonb);
    IF r.id IS NULL OR NOT (m ? 'sobrante_de') THEN RETURN 0; END IF;
    v_org := nullif(m->>'origen_branch_id', '')::integer;

    SELECT count(*)::integer,
           string_agg(trim(to_char(cantidad, 'FM999999990.##')) || ' de '
                      || coalesce(descripcion, 'el producto #' || erp_product_id)
                      || coalesce(' (' || lower(nullif(presentacion_tipo, '')) || ')', ''), '; ' ORDER BY posicion)
      INTO v_n, v_lista
      FROM public.envio_linea WHERE request_id = r.id AND estado = 'aceptada';
    IF coalesce(v_n, 0) = 0 THEN RETURN 0; END IF;

    v_dest := public.destinatarios_de_faltante(v_org, r.employee_id);
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;

    v_sala  := coalesce(nullif(m->>'branch_name', ''), 'La sala que recibió');
    v_osala := coalesce(nullif(m->>'origen_branch_name', ''), 'la sala que envió');
    SELECT nullif(metadata->>'codigo_bolsa', '') INTO v_bolsa
      FROM public.approval_requests WHERE id = (m->>'sobrante_de')::uuid;

    v_titulo := 'Llegó producto de más en un traslado';
    v_cuerpo := v_sala || ' recibió de más ' || v_lista
             || coalesce(' (bolsa ' || v_bolsa || ')', '')
             || '. Se descontó del inventario de ' || v_osala || ' y se sumó al de ' || v_sala || '.';
    v_link := '/traslados?tab=envios&envio=' || r.id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', r.id, 'request_type', r.type, 'resuelta', 'SOBRANTE',
                              'sobrante_de', m->>'sobrante_de'),
           v_org, r.employee_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        body    := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                                      'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)));

    RETURN array_length(v_dest, 1);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.avisar_sobrante(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_sobrante(uuid) TO service_role;

-- ── Declarar lo que vino de más ───────────────────────────────────────────
-- La llaman las dos funciones que reciben (`aplicar-traslado-inventario` al
-- recibir una solicitud, `enviar-producto-erp` al aceptar un envío) con quien
-- recibió ya resuelto. `p_sobrantes` viaja como POSICIONES de la bolsa
-- —`[{ posicion, cantidad, nota }]`, cantidad en la misma presentación del
-- renglón—: el navegador señala cuál de los productos que ya venían trajo de
-- más, nunca nombra uno. Mismo contrato que `declarar_faltantes`.
--
-- Un sobrante por bolsa: si ya se declaró, devuelve el envío que lo mueve.
-- La existencia de la sala de origen se mira ANTES de armar nada: si allá no
-- está, el producto de más no salió de su inventario y moverlo no corrige
-- nada — se dice, y lo ve supervisión.
CREATE OR REPLACE FUNCTION public.declarar_sobrantes(p_request_id uuid, p_sobrantes jsonb, p_actor uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r          public.approval_requests%ROWTYPE;
    m          jsonb;
    v_familia  text;
    s          jsonb;
    v_pos      integer;
    v_cant     numeric;
    v_nota     text;
    v_notas    text[] := ARRAY[]::text[];
    v_prod     integer;
    v_desc     text;
    v_pres     text;
    v_factor   integer;
    v_estado   text;
    v_items    jsonb := '[]'::jsonb;
    v_total    numeric := 0;
    v_org_erp  integer;
    v_dst_erp  integer;
    v_org_bid  integer;
    v_dst_bid  integer;
    v_org_nom  text;
    v_dst_nom  text;
    v_venc     boolean;
    v_tiene    numeric;
    v_dest     uuid[];
    v_esc      text;
    v_bolsa    text;
    v_ya       uuid;
    v_id       uuid;
    it         jsonb;
BEGIN
    SELECT * INTO r FROM public.approval_requests WHERE id = p_request_id;
    IF r.id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'No existe esa bolsa.');
    END IF;
    v_familia := CASE r.type
        WHEN 'INVENTORY_TRANSFER_REQUEST' THEN 'solicitud'
        WHEN 'INVENTORY_TRANSFER_PUSH'    THEN 'envio'
        ELSE NULL END;
    IF v_familia IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'Esa fila no es un traslado entre salas.');
    END IF;
    m := coalesce(r.metadata, '{}'::jsonb);
    -- Un sobrante de un sobrante no existe: lo de más ya entró con su envío.
    IF m ? 'sobrante_de' THEN
        RETURN json_build_object('ok', false, 'error', 'Esto ya es el movimiento de un sobrante.');
    END IF;
    IF v_familia = 'solicitud' AND m->'erp_recibido' IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'El traslado todavía no se recibió.');
    END IF;

    SELECT id INTO v_ya FROM public.approval_requests
     WHERE type = 'INVENTORY_TRANSFER_PUSH' AND metadata->>'sobrante_de' = r.id::text
     LIMIT 1;
    IF v_ya IS NOT NULL THEN
        RETURN json_build_object('ok', true, 'envio_id', v_ya, 'ya', true);
    END IF;

    v_org_erp := nullif(m->>'origen_erp_sucursal_id', '')::integer;
    v_dst_erp := nullif(m->>'erp_sucursal_id', '')::integer;
    v_venc    := coalesce((m->>'origen_vencidos')::boolean, false);
    SELECT em.branch_id, b.name INTO v_org_bid, v_org_nom
      FROM public.erp_sucursal_map em LEFT JOIN public.branches b ON b.id = em.branch_id
     WHERE em.erp_sucursal_id = v_org_erp;
    SELECT em.branch_id, b.name INTO v_dst_bid, v_dst_nom
      FROM public.erp_sucursal_map em LEFT JOIN public.branches b ON b.id = em.branch_id
     WHERE em.erp_sucursal_id = v_dst_erp;
    IF v_org_bid IS NULL OR v_dst_bid IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'La bolsa no dice de qué sala salió o a cuál llegó.');
    END IF;

    FOR s IN SELECT * FROM jsonb_array_elements(coalesce(p_sobrantes, '[]'::jsonb)) LOOP
        v_pos  := nullif(s->>'posicion', '')::integer;
        v_cant := nullif(s->>'cantidad', '')::numeric;
        v_nota := nullif(btrim(coalesce(s->>'nota', '')), '');
        CONTINUE WHEN v_pos IS NULL OR v_cant IS NULL OR v_cant <= 0;
        IF v_cant <> trunc(v_cant) THEN
            RETURN json_build_object('ok', false, 'error', 'Lo que vino de más se cuenta en presentaciones enteras.');
        END IF;

        v_prod := NULL; v_desc := NULL; v_pres := NULL; v_factor := NULL; v_estado := NULL;
        IF v_familia = 'envio' THEN
            SELECT l.erp_product_id, l.descripcion, l.presentacion_tipo, l.factor, l.estado
              INTO v_prod, v_desc, v_pres, v_factor, v_estado
              FROM public.envio_linea l
             WHERE l.request_id = r.id AND l.posicion = v_pos;
            IF v_prod IS NOT NULL AND v_estado <> 'aceptada' THEN
                RETURN json_build_object('ok', false,
                    'error', coalesce(v_desc, 'Ese producto') || ' no se recibió: no puede haber venido de más.');
            END IF;
        ELSE
            SELECT nullif(a.it->>'erp_product_id', '')::integer, a.it->>'descripcion',
                   a.it->>'presentacion_tipo', nullif(a.it->>'factor', '')::integer
              INTO v_prod, v_desc, v_pres, v_factor
              FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) WITH ORDINALITY AS a(it, n)
             WHERE a.n = v_pos + 1;
        END IF;
        IF v_prod IS NULL OR coalesce(v_factor, 0) <= 0 OR nullif(btrim(coalesce(v_pres, '')), '') IS NULL THEN
            RETURN json_build_object('ok', false,
                'error', format('La bolsa no tiene un producto completo en la posición %s.', v_pos));
        END IF;

        -- Lo que está en el inventario de la sala de origen, del mismo estante
        -- del que salió la bolsa.
        IF v_venc THEN
            SELECT coalesce(d.unidades, 0) INTO v_tiene FROM public.v_inventario_disponible_vencidos d
             WHERE d.erp_product_id = v_prod AND d.erp_sucursal_id = v_org_erp;
        ELSE
            SELECT coalesce(d.unidades, 0) INTO v_tiene FROM public.v_inventario_disponible d
             WHERE d.erp_product_id = v_prod AND d.erp_sucursal_id = v_org_erp;
        END IF;
        IF coalesce(v_tiene, 0) < v_cant * v_factor THEN
            RETURN json_build_object('ok', false, 'codigo', 'SIN_EXISTENCIA',
                'error', format('%s dice que tiene %s unidades de %s y vinieron %s de más: no se puede pasar a tu sala. Avísale a supervisión.',
                                coalesce(v_org_nom, 'La sala de origen'), coalesce(v_tiene, 0),
                                coalesce(v_desc, 'ese producto'), v_cant * v_factor));
        END IF;

        IF v_items @> jsonb_build_array(jsonb_build_object('erp_product_id', v_prod)) THEN
            RETURN json_build_object('ok', false, 'error', coalesce(v_desc, 'Un producto') || ' está dos veces en lo que vino de más.');
        END IF;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
            'erp_product_id', v_prod, 'descripcion', v_desc, 'presentacion_tipo', v_pres,
            'factor', v_factor, 'cantidad', v_cant));
        v_total := v_total + v_cant * v_factor;
        IF v_nota IS NOT NULL AND NOT (v_nota = ANY (v_notas)) THEN v_notas := v_notas || v_nota; END IF;
    END LOOP;

    IF jsonb_array_length(v_items) = 0 THEN
        RETURN json_build_object('ok', true, 'envio_id', NULL);
    END IF;

    SELECT rd.destinatarios, rd.escalon INTO v_dest, v_esc
      FROM public.resolver_destinatarios_traslado(v_dst_bid) rd;
    v_bolsa := nullif(m->>'codigo_bolsa', '');

    -- La marca que deja pasar este insert por `validar_envio_producto`. Vive
    -- sólo en esta transacción y se borra enseguida.
    PERFORM set_config('portal.sobrante_de', r.id::text, true);
    INSERT INTO public.approval_requests (type, status, employee_id, approver_id, note, metadata)
    VALUES (
        'INVENTORY_TRANSFER_PUSH', 'PENDING', p_actor,
        coalesce(v_dest[1], p_actor),
        coalesce(array_to_string(v_notas, ' · '), 'Llegó de más'),
        jsonb_build_object(
            'origen_erp_sucursal_id', v_org_erp,
            'erp_sucursal_id',        v_dst_erp,
            'origen_branch_id',       v_org_bid,
            'branch_id',              v_dst_bid,
            'origen_branch_name',     v_org_nom,
            'branch_name',            v_dst_nom,
            'origen_vencidos',        v_venc,
            'items',                  v_items,
            'motivo_tipo',            'Sobrante',
            'reason',                 'Llegó de más' || coalesce(' en la bolsa ' || v_bolsa, ''),
            'sobrante_de',            r.id,
            'sobrante_familia',       v_familia,
            'sobrante_bolsa',         v_bolsa,
            'destinatarios',          to_jsonb(coalesce(v_dest, ARRAY[]::uuid[])),
            'escalon_aviso',          v_esc,
            'total_unidades',         v_total))
    RETURNING id INTO v_id;
    PERFORM set_config('portal.sobrante_de', '', true);

    RETURN json_build_object('ok', true, 'envio_id', v_id, 'productos', jsonb_array_length(v_items));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.declarar_sobrantes(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declarar_sobrantes(uuid, jsonb, uuid) TO service_role;

-- ── Los dos triggers del envío, con su rama de sobrante ───────────────────
-- Se parchan sobre su definición VIVA (una línea de entrada en cada uno) en
-- vez de reescribirlos enteros: son funciones largas que otras sesiones
-- tocan, y reescribirlas desde una copia es cómo se pisa un arreglo ajeno.
-- Si el ancla no está, la migración falla en vez de dejar la rama afuera.
DO $do$
DECLARE
    d     text;
    ancla text;
BEGIN
    -- validar_envio_producto: el sobrante lo validó `declarar_sobrantes`.
    d := pg_get_functiondef('public.validar_envio_producto'::regproc);
    ancla := $a$IF NEW.type <> 'INVENTORY_TRANSFER_PUSH' THEN RETURN NEW; END IF;$a$;
    IF position('portal.sobrante_de' in d) = 0 THEN
        IF position(ancla in d) = 0 THEN
            RAISE EXCEPTION 'validar_envio_producto cambió: no está la línea de entrada.';
        END IF;
        d := replace(d, ancla, ancla || $b$

    -- Sobrante de traslado (2026-11-12): lo arma `declarar_sobrantes`, que ya
    -- validó la bolsa, los renglones y la existencia del origen. Sólo entra
    -- con su marca de transacción: un insert directo con `sobrante_de` rebota.
    IF coalesce(NEW.metadata, '{}'::jsonb) ? 'sobrante_de' THEN
        IF coalesce(current_setting('portal.sobrante_de', true), '') <> NEW.metadata->>'sobrante_de' THEN
            RAISE EXCEPTION 'Lo que llegó de más se declara al recibir la bolsa.';
        END IF;
        RETURN NEW;
    END IF;$b$);
        EXECUTE d;
    END IF;

    -- notificar_resolucion_envio: el aviso del sobrante tiene su propio texto.
    d := pg_get_functiondef('public.notificar_resolucion_envio'::regproc);
    ancla := $a$IF v_org IS NULL THEN RETURN NEW; END IF;$a$;
    IF position('avisar_sobrante' in d) = 0 THEN
        IF position(ancla in d) = 0 THEN
            RAISE EXCEPTION 'notificar_resolucion_envio cambió: no está la línea de entrada.';
        END IF;
        d := replace(d, ancla, ancla || $b$
    -- El envío de un sobrante (2026-11-12): no es «tu envío llegó», es «lo de
    -- más se descontó de tu inventario». Lo dice `avisar_sobrante`.
    IF m ? 'sobrante_de' THEN
        PERFORM public.avisar_sobrante(NEW.id);
        RETURN NEW;
    END IF;$b$);
        EXECUTE d;
    END IF;
END;
$do$;
