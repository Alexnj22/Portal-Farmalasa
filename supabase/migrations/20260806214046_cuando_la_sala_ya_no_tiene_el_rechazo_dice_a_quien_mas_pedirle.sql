-- Cuando la sala ya no tiene, el rechazo dice A QUIÉN MÁS pedirle.
--
-- El caso lo planteó el usuario el 2026-08-06 y el flujo no lo cubría bien:
-- «sala A pide 1 unidad a sala B, y sala B solo tiene 1. Sala C pide el mismo
-- producto a sala B, pero B se lo envió a A: ya no debería poder enviárselo a
-- C, solo rechazar, y en el rechazo sugerir a quién más pedirle que tenga.»
--
-- La mitad peligrosa ya estaba tapada: la aplicación relee la existencia real
-- antes de escribir, así que B no puede despachar lo que no tiene — le sale
-- «quedan 0 unidades». Pero eso se descubre APRETANDO el botón, y el aviso a C
-- muere en un rechazo sin explicación. Faltaban las otras dos mitades:
--
--   1. que la pantalla lo sepa ANTES, para ofrecer solo rechazar;
--   2. que el rechazo le sirva a quien pidió, diciéndole dónde sí hay.
--
-- Sin lo segundo, C se entera de que no y vuelve a empezar de cero: abrir la
-- consulta, buscar el producto, mirar qué sala lo tiene. El dato ya está acá.

SET lock_timeout = '5s';

-- ── 1 · ¿Todavía puede? ¿Y quién más puede? ─────────────────────────────────
-- INVOKER a propósito: lee la solicitud y el RLS decide si quien pregunta puede
-- verla. Una versión DEFINER contestaría sobre solicitudes que el que llama no
-- tiene derecho a mirar.
CREATE OR REPLACE FUNCTION public.get_traslado_disponibilidad(p_request_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
    WITH sol AS (
        SELECT a.metadata AS m,
               nullif(a.metadata->>'origen_erp_sucursal_id','')::integer AS origen,
               nullif(a.metadata->>'erp_sucursal_id','')::integer        AS destino,
               (a.metadata->'items'->0->>'erp_product_id')::integer      AS prod,
               coalesce((a.metadata->'items'->0->>'cantidad')::numeric, 0)
                 * coalesce((a.metadata->'items'->0->>'factor')::numeric, 1) AS pedido
        FROM public.approval_requests a
        WHERE a.id = p_request_id AND a.type = 'INVENTORY_TRANSFER_REQUEST'
    ),
    -- La existencia en unidades, con UN factor por (producto, tipo): dos
    -- presentaciones que se llaman igual contarían la misma fila dos veces.
    stock AS (
        SELECT i.erp_sucursal_id,
               sum(i.cantidad * coalesce(f.factor, 1))::integer AS unidades
        FROM public.inventory i
        CROSS JOIN sol
        LEFT JOIN LATERAL (
            SELECT pp.factor FROM public.product_precios pp
            JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
            WHERE pp.product_id = i.erp_product_id
              AND upper(pr.tipo) = upper(i.presentacion) AND pp.activo
            ORDER BY pp.factor LIMIT 1
        ) f ON true
        WHERE i.erp_product_id = sol.prod
          AND i.is_vencidos = false AND i.cantidad > 0
        GROUP BY 1
    ),
    minimos AS (
        SELECT sp.erp_sucursal_id,
               coalesce(sp.manual_min, sp.calc_min, sp.min_units, 0) AS minimo
        FROM public.product_stock_params sp CROSS JOIN sol
        WHERE sp.erp_product_id = sol.prod
    )
    SELECT json_build_object(
        'pedido', sol.pedido,
        'origen', json_build_object(
            'erp_sucursal_id', sol.origen,
            'unidades', coalesce(so.unidades, 0),
            'minimo',   coalesce(mo.minimo, 0),
            -- Puede ceder si le alcanza Y no queda debajo de su propio mínimo.
            'puede',    coalesce(so.unidades, 0) >= sol.pedido
                        AND coalesce(so.unidades, 0) - sol.pedido >= coalesce(mo.minimo, 0)
        ),
        'alternativas', coalesce((
            SELECT json_agg(json_build_object(
                       'erp_sucursal_id', s.erp_sucursal_id,
                       'sala',            coalesce(m.nombre, 'Sucursal ' || s.erp_sucursal_id),
                       'unidades',        s.unidades)
                     ORDER BY s.unidades DESC)
            FROM stock s
            LEFT JOIN minimos mi ON mi.erp_sucursal_id = s.erp_sucursal_id
            LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = s.erp_sucursal_id
            WHERE s.erp_sucursal_id <> sol.origen
              AND s.erp_sucursal_id <> sol.destino
              AND s.unidades >= sol.pedido
              AND s.unidades - sol.pedido >= coalesce(mi.minimo, 0)
        ), '[]'::json)
    )
    FROM sol
    LEFT JOIN stock   so ON so.erp_sucursal_id = sol.origen
    LEFT JOIN minimos mo ON mo.erp_sucursal_id = sol.origen;
$$;

REVOKE EXECUTE ON FUNCTION public.get_traslado_disponibilidad(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_traslado_disponibilidad(uuid) TO authenticated, service_role;

-- ── 2 · Quien pidió se entera de la respuesta ───────────────────────────────
-- Hasta acá no se enteraba de nada: la solicitud cambiaba de estado y el aviso
-- solo se le cerraba a quien tenía que decidir. Es el mismo hueco que en
-- Min/Max, donde el aviso vivía en una llamada aparte del navegador y nunca se
-- ejecutó ni una vez.
--
-- El aviso va a la SALA que pidió —jefatura y quien esté en turno—, no solo a
-- la persona: si salió de turno, alguien tiene que enterarse igual.
CREATE OR REPLACE FUNCTION public.notificar_resolucion_traslado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    m        jsonb   := coalesce(NEW.metadata, '{}'::jsonb);
    v_branch integer := nullif(m->>'branch_id', '')::integer;
    v_quien  text;
    v_que    text;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
    v_motivo text;
    v_alt    text;
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_REQUEST' THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN RETURN NEW; END IF;
    IF v_branch IS NULL THEN RETURN NEW; END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = NEW.approver_id;
    v_quien := coalesce(v_quien, 'La otra sala');
    v_que := coalesce(nullif(m->'items'->0->>'descripcion', ''), 'lo que pediste');

    -- Quien pidió, más la jefatura y el turno de su sala.
    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (e.id = NEW.employee_id
            OR (e.branch_id = v_branch
                AND (e.system_role IN ('JEFE','SUBJEFE')
                     OR e.id IN (SELECT t.employee_id FROM public.empleados_en_turno(v_branch) t))));
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN NEW; END IF;

    IF NEW.status = 'APPROVED' THEN
        v_titulo := '📦 Te lo van a enviar';
        v_cuerpo := v_quien || ' confirmó el traslado de ' || v_que
                 || ' desde ' || coalesce(nullif(m->>'origen_branch_name',''), 'la otra sala')
                 || '. Avisá cuando llegue para recibirlo.';
    ELSE
        v_motivo := nullif(btrim(coalesce(m->>'rejection_reason','')), '');
        -- La sugerencia es el motivo por el que este aviso existe: sin ella,
        -- quien pidió vuelve a empezar de cero — abrir la consulta, buscar el
        -- producto, mirar qué sala lo tiene. El dato ya lo teníamos.
        v_alt := nullif(btrim(coalesce(m->>'sugerencia','')), '');
        v_titulo := '🚫 No te lo pueden enviar';
        v_cuerpo := coalesce(nullif(m->>'origen_branch_name',''), 'La otra sala')
                 || ' no puede enviar ' || v_que
                 || coalesce(': ' || lower(v_motivo), '')
                 || coalesce('. ' || left(nullif(btrim(NEW.approver_note),''), 120), '')
                 || coalesce(' — ' || v_alt, '');
    END IF;

    v_link := '/requests?solicitud=' || NEW.id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'resuelta', NEW.status),
           v_branch, NEW.approver_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_resolucion_traslado ON public.approval_requests;
CREATE TRIGGER trg_notificar_resolucion_traslado
    AFTER UPDATE OF status ON public.approval_requests
    FOR EACH ROW EXECUTE FUNCTION public.notificar_resolucion_traslado();

REVOKE EXECUTE ON FUNCTION public.notificar_resolucion_traslado() FROM PUBLIC, anon;
