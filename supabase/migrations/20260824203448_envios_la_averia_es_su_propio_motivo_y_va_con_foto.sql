-- La avería es su propio motivo, sólo viaja hacia Bodega, y NO entra sin foto.
--
-- Pedido del usuario el 2026-08-24:
--
--   «en los traslados a bodega, que tambien este el motivo de averia, y que se
--    anexe foto.»
--
-- ── Por qué no alcanzaba con los cuatro que había ─────────────────────────
--
-- Una sala con producto golpeado, con el empaque roto o con el frasco quebrado
-- tenía que rotularlo «Baja rotación» o «Retiro del mercado», y ninguno de los
-- dos es cierto: no se movió porque sobrara ni porque el proveedor lo retirara,
-- se movió porque **está dañado**. Es la misma razón por la que se abrió
-- «Retiro del mercado» unas horas antes — un motivo que obliga a mentir es peor
-- que no tener el motivo, y el rótulo es el dato con el que después se mira el
-- circuito.
--
-- ── Por qué SÓLO hacia Bodega ─────────────────────────────────────────────
--
-- Igual que el retiro: lo averiado se consolida en un solo lugar para contarlo,
-- reclamarlo al proveedor o darlo de baja. De Bodega hacia una sala sería
-- mandar a la venta algo dañado, y entre salas sería repartir el problema.
--
-- La tabla completa queda así:
--
--   motivo             a Bodega   de Bodega a una sala   entre salas
--   ────────────────── ────────── ────────────────────── ───────────
--   Baja rotación         sí               sí                sí
--   Próximo a vencer      sí               sí                no
--   Producto nuevo        no               sí                no
--   Retiro del mercado    sí               no                no
--   Avería                SÍ               no                no
--
-- ── Por qué la foto es OBLIGATORIA, y por qué se exige acá ────────────────
--
-- Los otros cuatro motivos se pueden comprobar contra un dato: el vencimiento
-- está en el lote, la rotación en las ventas, el retiro en la orden. La avería
-- no: cuando la caja llega a Bodega, el daño ya viajó, y lo único que queda
-- para decidir si se reclama al proveedor, se repara o se da de baja es **haber
-- visto cómo salió**. Sin foto, quien recibe tiene una palabra y una caja.
--
-- Es exactamente la regla que ya vale en «Descargar por daño»
-- (`OPS_CON_FOTO`) y en la devolución de un pedido: la foto se pide donde se
-- puede ver algo. En un descuadre sería un trámite vacío.
--
-- Y se exige en la BASE y no sólo en la pantalla porque la pantalla no es la
-- que decide: `metadata` la arma el navegador, así que un envío por «Avería»
-- sin evidencia entra igual si nadie lo mira acá. Se comprueba además que las
-- URL apunten al bucket de evidencia — si no, «foto» podría ser la palabra
-- «si».
--
-- Qué motivos la piden vive en `motivos_envio_con_foto()` y no en un `IF`
-- suelto: es la misma forma que `motivos_envio_por_direccion()`, y es lo que
-- deja que la pantalla ofrezca exactamente lo que la base va a aceptar. Un
-- motivo que se ofrece y después rebota al apretar es peor que uno que nunca se
-- ofreció.
--
-- Verificado contra producción con siete casos insertados y revertidos en la
-- misma transacción: sin foto rebota, con `evidencia_urls` como texto rebota
-- con el mismo mensaje (y no con un error de tipos), con una URL ajena al
-- bucket rebota, con foto del bucket entra, entre salas y desde Bodega rebotan
-- por dirección, y «Baja rotación» sigue entrando sin evidencia.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.motivos_envio()
 RETURNS text[] LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT ARRAY['Próximo a vencer','Baja rotación','Producto nuevo','Retiro del mercado','Avería'];
$function$;

COMMENT ON FUNCTION public.motivos_envio() IS
  'Los motivos por los que se empuja producto. Lo demás es una solicitud. Cuáles valen en cada dirección lo dice motivos_envio_por_direccion() y cuáles piden foto motivos_envio_con_foto(); ésta es sólo el universo. Ver la migración envios_la_averia_es_su_propio_motivo_y_va_con_foto.';

CREATE OR REPLACE FUNCTION public.motivos_envio_por_direccion(
  p_origen_es_bodega  boolean,
  p_destino_es_bodega boolean)
 RETURNS text[] LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    -- Hacia Bodega: lo que una sala se saca de encima, más lo que Bodega pide
    -- de vuelta y lo que no se puede vender. «Producto nuevo» no entra, y de
    -- eso —y sólo de eso— sale que un producto nuevo únicamente pueda salir de
    -- Bodega.
    WHEN coalesce(p_destino_es_bodega, false)
      THEN ARRAY['Próximo a vencer','Baja rotación','Retiro del mercado','Avería']
    -- De Bodega a una sala: es reparto. Ni el retiro ni la avería están: las
    -- dos serían mandar a la venta algo que no puede venderse.
    WHEN coalesce(p_origen_es_bodega, false)
      THEN ARRAY['Producto nuevo','Baja rotación','Próximo a vencer']
    -- Entre salas: sólo «me sobra». Ni el vencimiento, ni el retiro, ni la
    -- avería, porque en los tres la pregunta es «¿quién se hace cargo?» y de
    -- eso se ocupa Bodega. Y lo que NO se puede decir entre salas es «te lo
    -- mando porque lo necesitás» — eso es una solicitud, donde el otro lado
    -- decide antes de que el producto salga.
    ELSE ARRAY['Baja rotación']
  END;
$function$;

COMMENT ON FUNCTION public.motivos_envio_por_direccion(boolean, boolean) IS
  'Qué motivos de envío valen entre estos dos extremos. Es la ÚNICA regla del circuito: la dirección no se decide aparte, sale de acá. Entre salas sólo vale «Baja rotación»; el retiro del mercado y la avería sólo viajan HACIA Bodega, que es donde se consolidan. La pantalla la usa para ofrecer sólo lo posible y validar_envio_producto para decidir.';

-- Qué motivos no entran sin evidencia. Una lista y no un `IF` suelto: la
-- pantalla la espeja para pedir la foto exactamente donde la base la va a
-- exigir.
CREATE OR REPLACE FUNCTION public.motivos_envio_con_foto()
 RETURNS text[] LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT ARRAY['Avería'];
$function$;

COMMENT ON FUNCTION public.motivos_envio_con_foto() IS
  'Los motivos de envío que NO entran sin al menos una foto. Hoy sólo la avería: es el único que no se puede comprobar contra un dato —el vencimiento está en el lote, la rotación en las ventas, el retiro en la orden—, y cuando la caja llega el daño ya viajó. La pantalla la espeja para pedirla; validar_envio_producto la exige.';

REVOKE EXECUTE ON FUNCTION public.motivos_envio_con_foto() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.motivos_envio_con_foto() TO authenticated, service_role;

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
