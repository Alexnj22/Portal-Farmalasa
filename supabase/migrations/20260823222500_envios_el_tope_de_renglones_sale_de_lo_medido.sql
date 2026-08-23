SET lock_timeout = '5s';

-- ── Cuántos productos entran en un envío ────────────────────────────────────
--
-- El tope EXISTÍA desde el primer día: el despacho corta a los 110 s y lo que
-- no salió queda para otra vuelta. Lo que no existía era decirlo — se descubría
-- a mitad de camino, con parte de la caja ya fuera de la sala.
--
-- ── De dónde sale el 20 ─────────────────────────────────────────────────────
-- Medido el 2026-08-23 sobre el pedido de Bodega, que despacha EXACTAMENTE
-- igual —un traslado por renglón, contra el mismo sistema, con las mismas
-- consultas por línea—. 3.137 renglones reales despachados entre el 12 y el 21
-- de agosto, midiendo el hueco entre dos despachos consecutivos de la misma
-- corrida:
--
--   mediana 2.686 ms · p90 4.317 ms · p99 5.970 ms · máximo 9.866 ms
--
-- Y el arranque —abrir sesión, leer las existencias de la ubicación, la foto de
-- pendientes— sobre 20 corridas: 5 s de promedio, 8 s en el p90. Ese tiempo no
-- está disponible para el bucle.
--
--   110 s de presupuesto − 8 s de arranque = 102 s
--   102 s ÷ 4,317 s (p90 por renglón)      = 23,6 renglones
--
-- Se fija en **20**: por debajo de ese 23,6, redondo, y con margen para un
-- renglón lento. En el peor caso absoluto (p99 en los veinte) serían 119 s y el
-- despacho se cortaría — pero desde v2.718.0 `continuar-envios` lo retoma solo,
-- así que pasarse dejó de ser fatal. Partir el envío ANTES sigue siendo mejor
-- que una caja a medio salir.
--
-- ⚠️ El número se revisa con datos, nunca a ojo: cada renglón despachado guarda
-- su `ms` en `envio_linea.detalle`, así que dentro de unas semanas el envío
-- podrá contestar esto con sus propias mediciones en vez de las del pedido.
--
-- ── Nota de archivo (2026-08-23) ────────────────────────────────────────────
-- Este archivo se RECUPERÓ del registro de producción
-- (`supabase_migrations.schema_migrations`) durante la auditoría del portal.
-- `apply_migration` la escribió en el servidor y el archivo local nunca se
-- guardó — es la deriva exacta que `npm run gate:migrations -- --remote` vigila,
-- y fue el único hallazgo de ese gate ese día. El SQL es idéntico al aplicado.
CREATE OR REPLACE FUNCTION public.tope_renglones_envio()
 RETURNS integer LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT 20;
$function$;
REVOKE EXECUTE ON FUNCTION public.tope_renglones_envio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tope_renglones_envio() TO authenticated, service_role;

COMMENT ON FUNCTION public.tope_renglones_envio() IS
  'Cuántos productos entran en un envío. 20, calculado sobre 3.137 renglones reales del pedido de Bodega (p90 4,3 s por renglón) contra los 110 s del despacho menos 8 s de arranque. Ver la migración 20260823_envios_el_tope_de_renglones_sale_de_lo_medido.';

-- Y el trigger lo cobra. La pantalla lo repite para poder avisar antes de
-- armar veinticinco renglones, pero la que manda es ésta: una validación que
-- sólo existe en el navegador es una sugerencia.
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

    SELECT branch_id INTO v_org_bid FROM public.erp_sucursal_map WHERE erp_sucursal_id = v_org_erp;
    SELECT branch_id INTO v_dst_bid FROM public.erp_sucursal_map WHERE erp_sucursal_id = v_dst_erp;
    IF v_org_bid IS NULL THEN
        RAISE EXCEPTION 'La sala que envía (%) no existe en el mapa.', v_org_erp;
    END IF;
    IF v_dst_bid IS NULL THEN
        RAISE EXCEPTION 'La sala que recibe (%) no existe en el mapa.', v_dst_erp;
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

    -- El tope. Un envío más largo no se rechaza por gusto: no entra en el
    -- tiempo que vive el despacho, y descubrirlo a mitad de camino deja media
    -- caja fuera de la sala.
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
