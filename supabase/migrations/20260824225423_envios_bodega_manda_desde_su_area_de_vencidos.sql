-- Bodega manda DESDE su área de vencidos, no sólo desde el estante.
--
-- Reportado por el usuario el 2026-08-24, con la pantalla delante:
--
--   «en los traslados desde bodega, no puedo mandar de la bodega de vencidos.
--    bodega si debe de poder enviar a una sucursal productos del area de
--    vencidos. y no sale.»
--
-- «Y no sale» es literal: el desplegable «Sale de» ofrecía «Bodega · 1 unidad»
-- y nada más, porque el buscador del modal descartaba `is_vencidos`. El área
-- con lo próximo a vencer —justo lo que más urge mover— no era ofrecible.
--
-- Lo que faltaba estaba ESCRITO desde esa misma mañana, al pie de
-- `20260824160758`: «LO QUE ESTO NO HACE: enviar DESDE el área de vencidos de
-- Bodega … Abrirlo es otra pieza: la ubicación de vencidos como origen en la
-- edge function, su rama en `validar_envio_producto` y el filtro `is_vencidos`
-- del buscador del modal.» Son exactamente esas tres, y esta migración es la
-- del medio.
--
-- ── Lo que NO cambia, y es donde está el riesgo ────────────────────────────
-- La regla de dirección no se toca: sólo Bodega le manda a una sala, y qué
-- motivos valen sale de `motivos_envio_por_direccion`. El área de vencidos es
-- un ESTANTE de Bodega, no una dirección nueva — y por eso tampoco se le
-- recorta la lista de motivos: hacerlo vaciaría la intersección de una
-- composición que saque del área de vencidos y de una sala a la vez, y esa
-- intersección nunca puede quedar vacía (ver el comentario de
-- `motivosEnvioPorDireccion` en `src/data/envios.js`). «Próximo a vencer» ya
-- está entre los que valen de Bodega a una sala, que es el motivo natural de
-- este viaje.
--
-- Lo que sí cambia es contra QUÉ se mide la existencia. Medir el área de
-- vencidos contra `v_inventario_disponible` —que filtra `is_vencidos = false`—
-- devuelve 0 y rebota el envío entero con un «no tienes N unidades» sobre
-- mercadería que está ahí. Es el mismo error que se corrigió en
-- `validar_solicitud_traslado` el 2026-08-19, del otro lado del viaje.
SET lock_timeout = '5s';

-- ── 1 · La validación mide contra el estante que el envío nombra ───────────
CREATE OR REPLACE FUNCTION public.validar_envio_producto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m           jsonb   := coalesce(NEW.metadata, '{}'::jsonb);
    v_items     jsonb   := m->'items';
    it          jsonb;
    v_org_erp   integer := nullif(m->>'origen_erp_sucursal_id', '')::integer;
    v_dst_erp   integer := nullif(m->>'erp_sucursal_id', '')::integer;
    -- De qué ESTANTE de la sala de origen sale. La clave ausente significa el
    -- de operación, que es como lo leen la edge function y el modal.
    v_venc      boolean := coalesce((m->>'origen_vencidos')::boolean, false);
    v_org_bid   integer;
    v_dst_bid   integer;
    v_org_bod   boolean;
    v_dst_bod   boolean;
    v_org_nom   text;
    v_dst_nom   text;
    v_ok        text[];
    v_solo_bod  text[];
    v_prod      integer;
    v_unid      numeric;
    v_tiene     numeric;
    v_total     numeric := 0;
    v_dest      uuid[];
    v_esc       text;
    v_motivo    text;
    v_detalle   text;
    v_mi_bid    integer;
    v_todo      boolean;
    v_fotos     integer;
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_PUSH' THEN RETURN NEW; END IF;

    IF NOT public.puede_enviar_producto(NEW.employee_id) THEN
        RAISE EXCEPTION 'No tienes permiso para enviar producto a otra sala.';
    END IF;

    v_motivo := nullif(btrim(coalesce(m->>'motivo_tipo', '')), '');
    IF v_motivo IS NULL OR NOT (v_motivo = ANY (public.motivos_envio())) THEN
        RAISE EXCEPTION 'El envío necesita un motivo. Los aceptados son %.',
            array_to_string(public.motivos_envio(), ', ');
    END IF;

    v_detalle := nullif(btrim(coalesce(m->>'reason', NEW.note, '')), '');
    IF v_detalle IS NULL THEN
        RAISE EXCEPTION 'Escribe por qué mandas este producto: el motivo es obligatorio.';
    END IF;
    IF length(v_detalle) < 4 OR lower(v_detalle) = lower(v_motivo) THEN
        RAISE EXCEPTION 'El motivo tiene que explicar por qué mandas el producto, no repetir la categoría.';
    END IF;

    IF v_org_erp IS NULL OR v_dst_erp IS NULL THEN
        RAISE EXCEPTION 'Falta la sala que envía o la que recibe.';
    END IF;
    IF v_org_erp = v_dst_erp THEN
        RAISE EXCEPTION 'No se puede enviar producto a la misma sala.';
    END IF;

    SELECT em.branch_id, coalesce(em.es_bodega, false), coalesce(b.name, 'la sala que envía')
      INTO v_org_bid, v_org_bod, v_org_nom
      FROM public.erp_sucursal_map em
      LEFT JOIN public.branches b ON b.id = em.branch_id
     WHERE em.erp_sucursal_id = v_org_erp;
    SELECT em.branch_id, coalesce(em.es_bodega, false), coalesce(b.name, 'la sala que recibe')
      INTO v_dst_bid, v_dst_bod, v_dst_nom
      FROM public.erp_sucursal_map em
      LEFT JOIN public.branches b ON b.id = em.branch_id
     WHERE em.erp_sucursal_id = v_dst_erp;
    IF v_org_bid IS NULL THEN
        RAISE EXCEPTION 'La sala que envía (%) no existe en el mapa.', v_org_erp;
    END IF;
    IF v_dst_bid IS NULL THEN
        RAISE EXCEPTION 'La sala que recibe (%) no existe en el mapa.', v_dst_erp;
    END IF;

    -- Sólo Bodega tiene área de vencidos. Un envío que dijera salir de la de
    -- una sala que no la tiene produciría un despacho sin ubicación de origen,
    -- y eso se descubre recién con la caja armada: se corta acá. Misma guarda
    -- —y misma redacción— que en `validar_solicitud_traslado`.
    IF v_venc AND NOT EXISTS (
        SELECT 1 FROM public.erp_sucursal_map m2,
                      jsonb_array_elements(coalesce(m2.inv_ubicaciones, '[]'::jsonb)) u
         WHERE m2.erp_sucursal_id = v_org_erp
           AND coalesce((u->>'isVencidos')::boolean, false)
    ) THEN
        RAISE EXCEPTION 'La sala que envía (%) no tiene área de vencidos.', v_org_erp;
    END IF;

    -- ── La ÚNICA regla del circuito ───────────────────────────────────────
    --
    -- El motivo tiene que valer entre estos dos extremos. La dirección no se
    -- comprueba aparte: sale de acá. Entre salas el único motivo es «Baja
    -- rotación» —o sea *me sobra*—, y con eso «te lo mando porque lo
    -- necesitás» sigue sin tener etiqueta: para eso está la solicitud, donde
    -- el otro lado decide ANTES de que el producto salga.
    --
    -- El ESTANTE no entra en esta cuenta a propósito: el área de vencidos es
    -- un estante de Bodega, no una dirección. Recortarle los motivos vaciaría
    -- la intersección de una composición que saque de ahí y de una sala a la
    -- vez, y esa intersección nunca puede quedar vacía.
    v_ok := public.motivos_envio_por_direccion(v_org_bod, v_dst_bod);
    IF NOT (v_motivo = ANY (v_ok)) THEN
        -- Los que sólo viajan HACIA Bodega, por diferencia contra los de esta
        -- dirección. Se calcula en vez de escribirse para que el mensaje no se
        -- quede viejo el día que se agregue un motivo — que es exactamente lo
        -- que pasó con «Retiro del mercado» y volvió a pasar con «Avería».
        SELECT coalesce(array_agg(x), ARRAY[]::text[]) INTO v_solo_bod
          FROM unnest(public.motivos_envio_por_direccion(false, true)) x
         WHERE NOT (x = ANY (v_ok));

        RAISE EXCEPTION '%',
            CASE
              WHEN NOT v_org_bod AND NOT v_dst_bod THEN
                format('Entre salas sólo se manda por %s. Si %s lo necesita, tiene que pedirlo%s.',
                    array_to_string(v_ok, ' o '),
                    v_dst_nom,
                    CASE WHEN coalesce(array_length(v_solo_bod, 1), 0) > 0
                         THEN format('; y si es por %s, mándalo a Bodega',
                                     array_to_string(v_solo_bod, ' o '))
                         ELSE '' END)
              WHEN v_dst_bod THEN
                format('A Bodega se manda por %s. «%s» no vale hacia Bodega.',
                    array_to_string(v_ok, ' o '), v_motivo)
              ELSE
                format('De Bodega a %s se manda por %s. «%s» no vale en esa dirección.',
                    v_dst_nom, array_to_string(v_ok, ' o '), v_motivo)
            END;
    END IF;

    -- ── La foto, donde el motivo la vuelve la única prueba ────────────────
    --
    -- Se comprueban las DOS cosas por separado —que sea un arreglo, y que
    -- traiga al menos una URL del bucket de evidencia— y no en un solo `OR`:
    -- `jsonb_array_elements_text` sobre algo que no es arreglo LANZA, y en un
    -- `OR` no hay corto circuito garantizado. Con un `evidencia_urls` que
    -- llegara como texto, el envío habría fallado con un error de tipos en vez
    -- de decir qué falta.
    IF v_motivo = ANY (public.motivos_envio_con_foto()) THEN
        IF coalesce(jsonb_typeof(m->'evidencia_urls'), 'null') <> 'array' THEN
            RAISE EXCEPTION 'Un envío por «%» no entra sin foto: adjunta al menos una.', v_motivo;
        END IF;
        SELECT count(*) INTO v_fotos
          FROM jsonb_array_elements_text(m->'evidencia_urls') u
         WHERE position('/inventario-evidencia/' in coalesce(u, '')) > 0;
        IF coalesce(v_fotos, 0) = 0 THEN
            RAISE EXCEPTION 'Un envío por «%» no entra sin foto: adjunta al menos una.', v_motivo;
        END IF;
    END IF;

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

    IF jsonb_array_length(v_items) > public.tope_renglones_envio() THEN
        RAISE EXCEPTION 'Un envío admite hasta % productos y este lleva %. Manda el resto en otro envío.',
            public.tope_renglones_envio(), jsonb_array_length(v_items);
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

        -- Y sale del ESTANTE que el envío nombra. Medir el área de vencidos
        -- contra la existencia normal —que filtra `is_vencidos = false`— da 0
        -- y rebota el envío entero sobre mercadería que está ahí: es lo mismo
        -- que rebotaba las solicitudes antes del 2026-08-19.
        IF v_venc THEN
            SELECT coalesce(d.unidades, 0) INTO v_tiene
              FROM public.v_inventario_disponible_vencidos d
             WHERE d.erp_product_id = v_prod AND d.erp_sucursal_id = v_org_erp;
        ELSE
            SELECT coalesce(d.unidades, 0) INTO v_tiene
              FROM public.v_inventario_disponible d
             WHERE d.erp_product_id = v_prod AND d.erp_sucursal_id = v_org_erp;
        END IF;

        IF coalesce(v_tiene, 0) < v_unid THEN
            RAISE EXCEPTION 'No tienes % unidades del producto % para enviar (tienes %).',
                v_unid, v_prod, coalesce(v_tiene, 0);
        END IF;
    END LOOP;

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

-- ── 2 · Y las tarjetas dicen de qué estante salió ──────────────────────────
-- Dos envíos de Bodega se ven idénticos si sólo se nombra la sala, y uno de
-- corto vence tiene que decirlo de sí mismo: es lo que explica por qué llegó.
-- Viaja como BOOLEANO y no pegado al nombre de la sala — un rótulo no es una
-- clave, y `origen_branch_name` se usa además para buscar.
CREATE OR REPLACE FUNCTION public.get_envios_vivos()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.created_at DESC), '[]'::json)
    FROM (
      SELECT r.id, r.status, r.created_at, r.updated_at,
             r.employee_id, r.approver_id, r.approver_note,
             r.metadata->>'motivo_tipo'                              AS motivo_tipo,
             coalesce(nullif(r.metadata->>'reason',''), r.note)      AS reason,
             CASE WHEN jsonb_typeof(r.metadata->'evidencia_urls') = 'array'
                  THEN r.metadata->'evidencia_urls' ELSE '[]'::jsonb END AS evidencia_urls,
             nullif(r.metadata->>'origen_branch_id','')::integer     AS origen_branch_id,
             r.metadata->>'origen_branch_name'                       AS origen_branch_name,
             nullif(r.metadata->>'origen_erp_sucursal_id','')::integer AS origen_erp_sucursal_id,
             coalesce((r.metadata->>'origen_vencidos')::boolean, false) AS origen_vencidos,
             nullif(r.metadata->>'branch_id','')::integer            AS branch_id,
             r.metadata->>'branch_name'                              AS branch_name,
             nullif(r.metadata->>'erp_sucursal_id','')::integer      AS erp_sucursal_id,
             (SELECT coalesce(json_agg(json_build_object(
                        'id', l.id, 'posicion', l.posicion,
                        'erp_product_id', l.erp_product_id, 'descripcion', l.descripcion,
                        'presentacion_tipo', l.presentacion_tipo, 'factor', l.factor,
                        'cantidad', l.cantidad, 'unidades', l.unidades,
                        'estado', l.estado, 'id_traslado', l.id_traslado,
                        'id_traslado_devolucion', l.id_traslado_devolucion,
                        'aviso', l.aviso, 'error', l.error,
                        'motivo_rechazo', l.motivo_rechazo, 'nota_rechazo', l.nota_rechazo,
                        'decidido_por', l.decidido_por, 'decidido_at', l.decidido_at,
                        'enviado_at', l.enviado_at, 'recibido_at', l.recibido_at,
                        'devuelto_at', l.devuelto_at) ORDER BY l.posicion), '[]'::json)
                FROM public.envio_linea l WHERE l.request_id = r.id) AS lineas
        FROM public.approval_requests r
       WHERE r.type = 'INVENTORY_TRANSFER_PUSH'
         AND EXISTS (SELECT 1 FROM public.envio_linea l
                      WHERE l.request_id = r.id
                        AND l.estado IN ('por_enviar','enviada','error','devuelta'))
    ) t;
$function$;

CREATE OR REPLACE FUNCTION public.get_envios_historial(p_limite integer DEFAULT 100)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.updated_at DESC), '[]'::json)
    FROM (
      SELECT r.id, r.status, r.created_at, r.updated_at,
             r.employee_id, r.approver_id, r.approver_note,
             r.metadata->>'motivo_tipo'                              AS motivo_tipo,
             coalesce(nullif(r.metadata->>'reason',''), r.note)      AS reason,
             CASE WHEN jsonb_typeof(r.metadata->'evidencia_urls') = 'array'
                  THEN r.metadata->'evidencia_urls' ELSE '[]'::jsonb END AS evidencia_urls,
             nullif(r.metadata->>'origen_branch_id','')::integer     AS origen_branch_id,
             r.metadata->>'origen_branch_name'                       AS origen_branch_name,
             coalesce((r.metadata->>'origen_vencidos')::boolean, false) AS origen_vencidos,
             nullif(r.metadata->>'branch_id','')::integer            AS branch_id,
             r.metadata->>'branch_name'                              AS branch_name,
             (SELECT coalesce(json_agg(json_build_object(
                        'posicion', l.posicion, 'descripcion', l.descripcion,
                        'erp_product_id', l.erp_product_id,
                        'presentacion_tipo', l.presentacion_tipo, 'factor', l.factor,
                        'cantidad', l.cantidad, 'unidades', l.unidades,
                        'estado', l.estado, 'motivo_rechazo', l.motivo_rechazo,
                        'nota_rechazo', l.nota_rechazo) ORDER BY l.posicion), '[]'::json)
                FROM public.envio_linea l WHERE l.request_id = r.id) AS lineas
        FROM public.approval_requests r
       WHERE r.type = 'INVENTORY_TRANSFER_PUSH'
         AND NOT EXISTS (SELECT 1 FROM public.envio_linea l
                          WHERE l.request_id = r.id
                            AND l.estado IN ('por_enviar','enviada','error','devuelta'))
       ORDER BY r.updated_at DESC
       LIMIT greatest(1, least(coalesce(p_limite, 100), 500))
    ) t;
$function$;

COMMENT ON FUNCTION public.validar_envio_producto() IS
  'Valida un envío de producto a otra sala antes de que exista: permiso, motivo por dirección, foto donde el motivo la exige, y existencia contra el ESTANTE que el envío nombra (el de operación, o el área de vencidos si metadata.origen_vencidos).';
