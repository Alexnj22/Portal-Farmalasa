SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- ENVIAR PRODUCTO A OTRA SALA — el circuito
-- Validación al crear · expansión a renglones · los tres avisos.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Las dos listas de motivos ──────────────────────────────────────────────
-- Viven en la base porque es la base la que rebota lo que no está en ellas: una
-- lista que sólo existe en la pantalla es una sugerencia. La pantalla las repite
-- para poder ofrecerlas sin una consulta, y si se agrega uno de un lado sin el
-- otro, el envío rebota — a propósito.
CREATE OR REPLACE FUNCTION public.motivos_envio()
 RETURNS text[] LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT ARRAY['Producto nuevo','Próximo a vencer','Sobrestock','Lo pidieron','Otro'];
$function$;

CREATE OR REPLACE FUNCTION public.motivos_rechazo_envio()
 RETURNS text[] LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT ARRAY['No lo vendo en mi sala','Ya tengo suficiente','Producto dañado',
               'Muy próximo a vencer','No me corresponde','Otro'];
$function$;

-- Quién puede EMPUJAR producto fuera de su sala. `can_edit`, no `can_approve`:
-- decidir sobre lo que llega es del otro lado, y ahí ya manda
-- `puede_confirmar_traslado`. Mismo formato que aquélla —los dos cargos, más el
-- superadmin— para que las dos se lean juntas.
CREATE OR REPLACE FUNCTION public.puede_enviar_producto(p_employee_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = p_employee_id
          AND (
              coalesce(e.system_role, '') = 'SUPERADMIN'
              OR EXISTS (SELECT 1 FROM public.role_permissions rp
                          WHERE rp.role_id = e.role_id
                            AND rp.module_key = 'traslados' AND rp.can_edit)
              OR EXISTS (SELECT 1 FROM public.role_permissions rp
                          WHERE rp.role_id = e.secondary_role_id
                            AND rp.module_key = 'traslados' AND rp.can_edit)
          )
    );
$function$;

REVOKE EXECUTE ON FUNCTION public.motivos_envio() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.motivos_rechazo_envio() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.puede_enviar_producto(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.motivos_envio() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.motivos_rechazo_envio() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.puede_enviar_producto(uuid) TO authenticated, service_role;

-- ── 1 · Qué tiene que traer un envío para poder nacer ──────────────────────
-- Es la gemela de `validar_solicitud_traslado`, con las dos diferencias de
-- fondo: acá la existencia se mide en la sala de QUIEN ENVÍA, y los
-- destinatarios del aviso son los de la sala de DESTINO — la que va a decidir.
CREATE OR REPLACE FUNCTION public.validar_envio_producto()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m           jsonb   := coalesce(NEW.metadata, '{}'::jsonb);
    v_items     jsonb   := m->'items';
    it          jsonb;
    v_org_erp   integer := nullif(m->>'origen_erp_sucursal_id', '')::integer;
    v_dst_erp   integer := nullif(m->>'erp_sucursal_id', '')::integer;
    v_org_bid   integer;
    v_dst_bid   integer;
    v_prod      integer;
    v_unid      numeric;
    v_tiene     numeric;
    v_total     numeric := 0;
    v_dest      uuid[];
    v_esc       text;
    v_motivo    text;
    v_mi_bid    integer;
    v_todo      boolean;
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_PUSH' THEN RETURN NEW; END IF;

    IF NOT public.puede_enviar_producto(NEW.employee_id) THEN
        RAISE EXCEPTION 'No tienes permiso para enviar producto a otra sala.';
    END IF;

    -- El motivo es lo único que le explica al otro lado por qué le llegó una
    -- caja que no pidió. Por eso es obligatorio y por eso es de una lista: «te
    -- mando esto» sin motivo es exactamente lo que hoy se resuelve por teléfono.
    v_motivo := nullif(btrim(coalesce(m->>'motivo_tipo', '')), '');
    IF v_motivo IS NULL OR NOT (v_motivo = ANY (public.motivos_envio())) THEN
        RAISE EXCEPTION 'El envío necesita un motivo. Los aceptados son %.',
            array_to_string(public.motivos_envio(), ', ');
    END IF;
    IF v_motivo = 'Otro' AND nullif(btrim(coalesce(m->>'reason', NEW.note, '')), '') IS NULL THEN
        RAISE EXCEPTION 'El motivo «Otro» necesita que se escriba cuál.';
    END IF;

    IF v_org_erp IS NULL OR v_dst_erp IS NULL THEN
        RAISE EXCEPTION 'Falta la sala que envía o la que recibe.';
    END IF;
    IF v_org_erp = v_dst_erp THEN
        RAISE EXCEPTION 'No se puede enviar producto a la misma sala.';
    END IF;

    SELECT branch_id INTO v_org_bid FROM public.erp_sucursal_map WHERE erp_sucursal_id = v_org_erp;
    SELECT branch_id INTO v_dst_bid FROM public.erp_sucursal_map WHERE erp_sucursal_id = v_dst_erp;
    IF v_org_bid IS NULL THEN
        RAISE EXCEPTION 'La sala que envía (%) no existe en el mapa.', v_org_erp;
    END IF;
    IF v_dst_bid IS NULL THEN
        RAISE EXCEPTION 'La sala que recibe (%) no existe en el mapa.', v_dst_erp;
    END IF;

    -- ── De MI sala, no de cualquiera ───────────────────────────────────────
    -- Un envío saca producto de una sala sin pedirle permiso a nadie: la
    -- decisión llega después. Así que el freno tiene que estar acá — quien envía
    -- es de esa sala, la cubre mientras está cerrada, o tiene alcance sobre
    -- todas. Sin esto, cualquiera podría vaciar la sala de otro.
    SELECT branch_id INTO v_mi_bid FROM public.employees WHERE id = NEW.employee_id;
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
         WHERE e.id = NEW.employee_id
           AND (coalesce(e.system_role,'') = 'SUPERADMIN'
                OR EXISTS (SELECT 1 FROM public.role_permissions rp
                            WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                              AND rp.module_key = 'traslados' AND rp.scope = 'ALL'))
    ) INTO v_todo;

    IF NOT v_todo
       AND v_mi_bid IS DISTINCT FROM v_org_bid
       AND NOT (v_org_bid = ANY (coalesce(public.salas_que_cubre_ahora(v_mi_bid), ARRAY[]::integer[]))) THEN
        RAISE EXCEPTION 'Sólo se puede enviar producto desde tu propia sala.';
    END IF;

    IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION 'El envío no lleva ni un producto.';
    END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        v_prod := coalesce(nullif(it->>'erp_product_id', '')::integer, 0);
        IF v_prod <= 0 THEN
            RAISE EXCEPTION 'Hay una línea sin producto.';
        END IF;
        IF nullif(btrim(coalesce(it->>'presentacion_tipo', '')), '') IS NULL THEN
            RAISE EXCEPTION 'La línea del producto % no dice qué presentación es.', v_prod;
        END IF;
        IF coalesce(nullif(it->>'factor', '')::integer, 0) <= 0 THEN
            RAISE EXCEPTION 'La presentación del producto % no trae su factor.', v_prod;
        END IF;
        IF coalesce(nullif(it->>'cantidad', '')::numeric, 0) <= 0 THEN
            RAISE EXCEPTION 'La línea del producto % no tiene cantidad.', v_prod;
        END IF;

        v_unid  := (it->>'cantidad')::numeric * (it->>'factor')::integer;
        v_total := v_total + v_unid;

        SELECT coalesce(d.unidades, 0) INTO v_tiene
          FROM public.v_inventario_disponible d
         WHERE d.erp_product_id = v_prod AND d.erp_sucursal_id = v_org_erp;

        IF coalesce(v_tiene, 0) < v_unid THEN
            RAISE EXCEPTION 'No tienes % unidades del producto % para enviar (tienes %).',
                v_unid, v_prod, coalesce(v_tiene, 0);
        END IF;
    END LOOP;

    -- A quién le avisa. Es la MISMA cascada del traslado —sala, sala de
    -- respaldo si está cerrada, supervisión— pero mirando la de destino.
    SELECT r.destinatarios, r.escalon INTO v_dest, v_esc
      FROM public.resolver_destinatarios_traslado(v_dst_bid) r;

    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN
        RAISE EXCEPTION 'No hay a quién avisarle en la sala de destino.';
    END IF;

    NEW.approver_id := v_dest[1];
    NEW.metadata := m
        || jsonb_build_object(
             'origen_branch_id', v_org_bid,
             'branch_id',        v_dst_bid,
             'destinatarios',    to_jsonb(v_dest),
             'escalon_aviso',    v_esc,
             'total_unidades',   v_total);

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validar_envio_producto ON public.approval_requests;
CREATE TRIGGER trg_validar_envio_producto
BEFORE INSERT ON public.approval_requests
FOR EACH ROW WHEN (new.type = 'INVENTORY_TRANSFER_PUSH')
EXECUTE FUNCTION public.validar_envio_producto();

-- ── 2 · La cabecera se abre en renglones ───────────────────────────────────
-- En la MISMA transacción que la fila. Un `insert` aparte desde el navegador es
-- justo lo que deja envíos sin renglones cuando la segunda llamada no sale.
CREATE OR REPLACE FUNCTION public.expandir_lineas_envio()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    INSERT INTO public.envio_linea
        (request_id, posicion, erp_product_id, descripcion, presentacion_tipo,
         factor, cantidad, unidades, lotes)
    SELECT NEW.id, (t.ord - 1)::integer,
           (t.it->>'erp_product_id')::integer,
           nullif(btrim(coalesce(t.it->>'descripcion','')), ''),
           t.it->>'presentacion_tipo',
           (t.it->>'factor')::integer,
           (t.it->>'cantidad')::numeric,
           (t.it->>'cantidad')::numeric * (t.it->>'factor')::integer,
           CASE WHEN jsonb_typeof(t.it->'lotes') = 'array' THEN t.it->'lotes' ELSE NULL END
      FROM jsonb_array_elements(coalesce(NEW.metadata->'items','[]'::jsonb)) WITH ORDINALITY AS t(it, ord);
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_expandir_lineas_envio ON public.approval_requests;
CREATE TRIGGER trg_expandir_lineas_envio
AFTER INSERT ON public.approval_requests
FOR EACH ROW WHEN (new.type = 'INVENTORY_TRANSFER_PUSH')
EXECUTE FUNCTION public.expandir_lineas_envio();

-- ── 3 · El aviso al destino sale cuando el producto SALIÓ ──────────────────
-- No al crear la fila. Entre crearla y despachar puede fallar el sistema, y un
-- aviso de una caja que no salió manda a alguien a buscar lo que no existe. Por
-- eso el aviso genérico no corre para este tipo y lo llama la Edge Function
-- cuando ya tiene los vales.
DROP TRIGGER IF EXISTS trg_notificar_solicitud_creada ON public.approval_requests;
CREATE TRIGGER trg_notificar_solicitud_creada
AFTER INSERT ON public.approval_requests
FOR EACH ROW WHEN (new.type <> 'INVENTORY_TRANSFER_PUSH')
EXECUTE FUNCTION public.notificar_solicitud_creada();

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

    v_link := '/traslados?envio=' || r.id;

    SELECT coalesce(
             (SELECT array_agg((d)::uuid) FROM jsonb_array_elements_text(m->'destinatarios') d),
             ARRAY[r.approver_id]) INTO v_dest;
    v_dest := (SELECT array_agg(DISTINCT x) FROM unnest(v_dest) x WHERE x IS NOT NULL AND x <> r.employee_id);
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;

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

REVOKE EXECUTE ON FUNCTION public.notificar_envio_despachado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notificar_envio_despachado(uuid) TO service_role;

-- ── 4 · Y el aviso de vuelta, a quien envió ────────────────────────────────
CREATE OR REPLACE FUNCTION public.notificar_resolucion_envio()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m        jsonb   := coalesce(NEW.metadata, '{}'::jsonb);
    v_org    integer := nullif(m->>'origen_branch_id', '')::integer;
    v_quien  text;
    v_ok     integer;
    v_no     integer;
    v_lista  text;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_PUSH' THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN RETURN NEW; END IF;
    IF v_org IS NULL THEN RETURN NEW; END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = NEW.approver_id;
    v_quien := coalesce(v_quien, coalesce(nullif(m->>'branch_name',''), 'La otra sala'));

    SELECT count(*) FILTER (WHERE estado = 'aceptada'),
           count(*) FILTER (WHERE estado IN ('devuelta','devuelta_recibida'))
      INTO v_ok, v_no
      FROM public.envio_linea WHERE request_id = NEW.id;

    -- Qué devuelven y por qué, renglón por renglón: es lo único que le dice a
    -- quien envió qué caja va a volver y qué hacer con ella.
    SELECT string_agg(coalesce(descripcion, 'el producto #' || erp_product_id)
                      || ' (' || coalesce(motivo_rechazo, 'sin motivo') || ')', '; ' ORDER BY posicion)
      INTO v_lista
      FROM public.envio_linea
     WHERE request_id = NEW.id AND estado IN ('devuelta','devuelta_recibida');

    -- Quien envió, más la jefatura y el turno de su sala: la caja vuelve a la
    -- sala, no a la persona, y quien la despachó puede estar de descanso.
    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (e.id = NEW.employee_id
            OR (e.branch_id = v_org
                AND (e.system_role IN ('JEFE','SUBJEFE')
                     OR e.id IN (SELECT t.employee_id FROM public.empleados_en_turno(v_org) t))));
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN NEW; END IF;

    IF coalesce(v_no, 0) = 0 THEN
        v_titulo := '✅ Recibieron tu envío';
        v_cuerpo := v_quien || ' aceptó ' || v_ok
                 || CASE WHEN v_ok = 1 THEN ' producto' ELSE ' productos' END || ' de tu envío.';
    ELSE
        v_titulo := '↩️ Te devuelven producto';
        v_cuerpo := v_quien || ' devuelve ' || v_no
                 || CASE WHEN v_no = 1 THEN ' producto' ELSE ' productos' END
                 || CASE WHEN coalesce(v_ok,0) > 0 THEN ' y se queda con ' || v_ok ELSE '' END
                 || coalesce(': ' || v_lista, '')
                 || '. Confirma cuando la caja esté de vuelta en tu sala.';
    END IF;

    v_link := '/traslados?envio=' || NEW.id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'resuelta', NEW.status),
           v_org, NEW.approver_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notificar_resolucion_envio ON public.approval_requests;
CREATE TRIGGER trg_notificar_resolucion_envio
AFTER UPDATE OF status ON public.approval_requests
FOR EACH ROW WHEN (new.type = 'INVENTORY_TRANSFER_PUSH')
EXECUTE FUNCTION public.notificar_resolucion_envio();
