-- El mensaje de «entre salas» se deriva de la tabla, no se escribe a mano.
--
-- Se descubrió minutos después de agregar «Retiro del mercado» (2026-08-24):
-- el rechazo de un envío entre salas seguía diciendo
--
--   «… y si es por vencimiento, mándalo a Bodega.»
--
-- cuando ya había DOS motivos que sólo viajan hacia Bodega. El mensaje no
-- fallaba —no hay forma de que un texto falle— simplemente quedó viejo, y quien
-- lo leyera creería que un retiro no tiene a dónde ir.
--
-- Es la misma familia que la lista de opciones escrita a mano contra la tabla:
-- dos sitios que dicen lo mismo y sólo uno se actualiza. La salida es la misma:
-- que la frase SALGA de la tabla. Ahora nombra los motivos que valen entre
-- salas y, por diferencia, los que hay que mandar a Bodega — así el día que se
-- agregue o se mueva un motivo, el texto se corrige solo.
--
-- La pantalla hace la MISMA cuenta, por el mismo motivo: `soloHaciaBodega` en
-- `EnviarProductoModal`.
--
-- Lo único que cambia en esta función es ese `CASE`. El resto es idéntico.
SET lock_timeout = '5s';

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

    -- ── La ÚNICA regla del circuito ───────────────────────────────────────
    --
    -- El motivo tiene que valer entre estos dos extremos. La dirección no se
    -- comprueba aparte: sale de acá. Entre salas el único motivo es «Baja
    -- rotación» —o sea *me sobra*—, y con eso «te lo mando porque lo
    -- necesitás» sigue sin tener etiqueta: para eso está la solicitud, donde
    -- el otro lado decide ANTES de que el producto salga.
    v_ok := public.motivos_envio_por_direccion(v_org_bod, v_dst_bod);
    IF NOT (v_motivo = ANY (v_ok)) THEN
        -- Los que sólo viajan HACIA Bodega, por diferencia contra los de esta
        -- dirección. Se calcula en vez de escribirse para que el mensaje no se
        -- quede viejo el día que se agregue un motivo — que es exactamente lo
        -- que acababa de pasar con «Retiro del mercado».
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

        SELECT coalesce(d.unidades, 0) INTO v_tiene
          FROM public.v_inventario_disponible d
         WHERE d.erp_product_id = v_prod AND d.erp_sucursal_id = v_org_erp;

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
