-- Entre salas sí se manda, pero SÓLO por baja rotación.
--
-- Tercera y última corrección del usuario el 2026-08-24, después de probarlo en
-- pantalla desde una cuenta de sala y encontrar el destino fijo en Bodega:
--
--   «pero si es por baja rotacion, si debe poder enviarse a otra sucursal.»
--
-- ── Lo que estaba mal no era el freno: era DÓNDE vivía ────────────────────
--
-- Las dos versiones anteriores de hoy pusieron el freno en la DIRECCIÓN —«sólo
-- Bodega le manda a una sala»— y encima le colgaron una tabla de motivos. Eran
-- dos reglas para una sola pregunta, y por eso la tercera respuesta no entraba:
-- no existe una dirección que sea buena o mala en sí misma. Lo que decide es el
-- MOTIVO, y la dirección es una consecuencia suya.
--
-- Dicho al derecho: un producto que no rota en Salud 1 y sí en Salud 3 no gana
-- nada dando la vuelta por Bodega. Pero un producto próximo a vencer sí, porque
-- ahí la pregunta no es «¿a quién le sirve?» sino «¿quién se hace cargo?», y de
-- eso se ocupa Bodega. Y uno nuevo sólo puede salir de donde entró la compra.
--
-- Entonces queda UNA regla, la de motivos, y la dirección sale de ella:
--
--   motivo             de una sala a Bodega   de Bodega a una sala   entre salas
--   ────────────────── ────────────────────── ────────────────────── ───────────
--   Baja rotación               sí                     sí                SÍ
--   Próximo a vencer            sí                     sí                no
--   Producto nuevo              no                     sí                no
--
-- **Y sigue sin haber por dónde colar una solicitud disfrazada**, que es lo que
-- se estaba defendiendo desde el principio: entre salas el único motivo es
-- «Baja rotación», o sea *me sobra*. «Te lo mando porque lo necesitás» no tiene
-- etiqueta — para eso está la solicitud, donde el otro lado decide ANTES de que
-- el producto salga. Lo que se abrió no es una puerta nueva: es la mitad
-- legítima de la que se había cerrado de más.
--
-- ── Por qué la función cambia de firma ────────────────────────────────────
--
-- `motivos_envio_por_destino(boolean)` no alcanza: con el destino solo, «de
-- Bodega a una sala» y «entre salas» son el mismo caso, y ahora se distinguen.
-- La nueva recibe los dos extremos. La vieja se ELIMINA en vez de dejarla al
-- lado: una firma que queda viva es una que alguien va a llamar, y las dos no
-- contestan lo mismo. (Es la lección de `update_proveedor_manual`, donde una
-- revocación alcanzó a una sobrecarga y no a la otra.)
--
-- Y el bloque «la dirección» sale de `validar_envio_producto`. No se relaja
-- nada: lo que hacía ahora lo hace el motivo, con un mensaje que además dice
-- qué hacer en su lugar. Dos frenos para una regla es cómo se llega a que uno
-- de los dos diga algo distinto del otro.
--
-- Verificado contra producción con los OCHO casos de la tabla, insertados y
-- revertidos en la misma transacción: sala→sala por baja rotación pasa, por
-- vencimiento y por producto nuevo rebotan con su mensaje propio, y las cuatro
-- combinaciones con Bodega en una punta dan lo que dice la tabla.
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.motivos_envio_por_destino(boolean);

CREATE OR REPLACE FUNCTION public.motivos_envio_por_direccion(p_origen_es_bodega boolean, p_destino_es_bodega boolean)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    -- Hacia Bodega: lo que una sala se saca de encima. «Producto nuevo» no
    -- entra, y de eso —y sólo de eso— sale que un producto nuevo únicamente
    -- pueda salir de Bodega.
    WHEN coalesce(p_destino_es_bodega, false)
      THEN ARRAY['Próximo a vencer','Baja rotación']
    -- De Bodega a una sala: es reparto, y Bodega reparte las tres cosas.
    WHEN coalesce(p_origen_es_bodega, false)
      THEN ARRAY['Producto nuevo','Baja rotación','Próximo a vencer']
    -- Entre salas: sólo «me sobra». Un producto que no rota acá y sí allá no
    -- gana nada dando la vuelta por Bodega. Lo que NO se puede decir es «te lo
    -- mando porque lo necesitás» — eso es una solicitud, y ahí el otro lado
    -- decide antes de que el producto salga.
    ELSE ARRAY['Baja rotación']
  END;
$function$;

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
        RAISE EXCEPTION '%',
            CASE
              WHEN NOT v_org_bod AND NOT v_dst_bod THEN
                format('Entre salas sólo se manda por «Baja rotación». Si %s lo necesita, tiene que pedirlo; '
                    || 'y si es por vencimiento, mándalo a Bodega.', v_dst_nom)
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
REVOKE EXECUTE ON FUNCTION public.motivos_envio_por_direccion(boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.motivos_envio_por_direccion(boolean, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.motivos_envio_por_direccion(boolean, boolean) IS
  'Qué motivos de envío valen entre estos dos extremos. Es la ÚNICA regla del circuito: la dirección no se decide aparte, sale de acá. Entre salas sólo vale «Baja rotación» — todo lo demás entre salas es una solicitud. La pantalla la usa para ofrecer sólo lo posible y validar_envio_producto para decidir.';
