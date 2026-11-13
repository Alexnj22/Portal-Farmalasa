-- Envío a otra sala: quien está de APOYO hoy manda sólo desde la sala del apoyo.
--
-- 2026-11-13, pedido del usuario: «debe ser solo donde esta hoy. si el apoyo
-- de ahora es salud 4, debe salir de salud 4, si mañana estoy en bodega, debe
-- salir de bodega» — y «que sea estricto para los apoyo». La migración
-- 20261113213021 ya resolvía la sala efectiva (apoyo → sala elegida → ficha);
-- ésta agrega que, con un apoyo vigente HOY, la única sala de origen válida es
-- la del apoyo: no vale la de respaldo cerrada ni el alcance sobre todas. Los
-- días sin apoyo sigue la regla de antes (la ficha, con sus excepciones).
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
    v_cargo_ap  integer;
    v_apoyo     integer;
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_PUSH' THEN RETURN NEW; END IF;

    -- Sobrante de traslado (2026-11-12): lo arma `declarar_sobrantes`, que ya
    -- validó la bolsa, los renglones y la existencia del origen. Sólo entra
    -- con su marca de transacción: un insert directo con `sobrante_de` rebota.
    IF coalesce(NEW.metadata, '{}'::jsonb) ? 'sobrante_de' THEN
        IF coalesce(current_setting('portal.sobrante_de', true), '') <> NEW.metadata->>'sobrante_de' THEN
            RAISE EXCEPTION 'Lo que llegó de más se declara al recibir el paquete.';
        END IF;
        RETURN NEW;
    END IF;

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

    -- La sala y el cargo EFECTIVOS de quien manda, con la precedencia de
    -- `auth_yo()` y del perfil del portal: apoyo vigente → sala elegida (si
    -- todavía la cubre) → ficha. En los días de un apoyo con cargo, el cargo es
    -- el que cubre y nada más. Con la ficha a secas, quien estaba de apoyo veía
    -- en pantalla el producto de la sala del apoyo y la base se lo rebotaba.
    SELECT coalesce(public.sala_de_apoyo_vigente(e.id)::integer,
                    (SELECT sa.branch_id::integer FROM public.sala_activa sa
                      WHERE sa.employee_id = e.id
                        AND EXISTS (SELECT 1 FROM public.employee_branches eb
                                     WHERE eb.employee_id = sa.employee_id AND eb.branch_id = sa.branch_id)),
                    e.branch_id::integer),
           public.cargo_de_apoyo_vigente(e.id)::integer
      INTO v_mi_bid, v_cargo_ap
      FROM public.employees e WHERE e.id = NEW.employee_id;
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
         WHERE e.id = NEW.employee_id
           AND (false /* llave maestra retirada 2026-08-28: ya no hay quien la porte — ver docs/PLAN-ROLES-SIN-SYSTEM-ROLE-2026-08-28.md */
                OR EXISTS (SELECT 1 FROM public.role_permissions rp
                            WHERE rp.role_id IN (coalesce(v_cargo_ap, e.role_id),
                                                 CASE WHEN v_cargo_ap IS NULL THEN e.secondary_role_id END)
                              AND rp.module_key = 'traslados' AND rp.scope = 'ALL'))
    ) INTO v_todo;

    -- Con un apoyo vigente HOY, estricto: sólo la sala del apoyo. Ni la de
    -- respaldo cerrada ni el alcance sobre todas — el día del apoyo la persona
    -- está en esa sala y en ninguna otra. Al día siguiente sin apoyo, vuelve
    -- sola a la regla de abajo (`sala_de_apoyo_vigente` mira la fecha de SV).
    v_apoyo := public.sala_de_apoyo_vigente(NEW.employee_id)::integer;
    IF v_apoyo IS NOT NULL THEN
        IF v_org_bid IS DISTINCT FROM v_apoyo THEN
            RAISE EXCEPTION 'Hoy estás de apoyo en %: sólo puedes enviar producto de esa sala.',
                coalesce((SELECT b.name FROM public.branches b WHERE b.id = v_apoyo), 'otra sala');
        END IF;
    ELSIF NOT v_todo
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
