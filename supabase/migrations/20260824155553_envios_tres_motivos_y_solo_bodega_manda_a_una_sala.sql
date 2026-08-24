-- Envíos: tres motivos, y sólo Bodega le manda a una sala.
--
-- Pedido del usuario el 2026-08-24, después de preguntarse cómo evitar que las
-- salas usaran el envío en vez de la solicitud:
--
--   «el fin de poder hacer traslados es: 1. enviar productos a bodega por corto
--    vencimiento o baja rotacion. 2. enviar productos a una sucursal por baja
--    rotacion. 3. enviar productos nuevos desde bodega. y ya.»
--   «no puede. solo bodega puede enviar a sucursales.»
--   «solo esos 3 motivos existen para enviar productos por traslado. lo demas
--    son solicitudes.»
--
-- ── Por qué esto es el arreglo, y no una medición ─────────────────────────
--
-- La puerta abierta no era un umbral mal puesto: eran DOS ETIQUETAS. La lista
-- vieja traía «Lo pidieron» y «Otro», y con cualquiera de las dos una sala
-- mandaba lo que quisiera a donde quisiera. «Lo pidieron» ya tiene camino
-- propio —la solicitud, que es donde el otro lado decide ANTES de que el
-- producto salga— y «Otro» es por donde entra todo lo demás. «Sobrestock» se
-- va con ellas: lo que nombra es baja rotación, y dos nombres para lo mismo
-- terminan queriendo decir cosas distintas.
--
-- Se probó primero el camino de comprobar el motivo contra el dato —que el lote
-- venciera de verdad, que el producto no rotara de verdad— y el usuario lo
-- descartó por una razón medida: **la fecha de vencimiento falta en la mayoría
-- del inventario**. En Salud 1, 1.157 de 1.898 productos con existencia no
-- tienen fecha en ningún lote. Un candado sobre un dato que falta no frena al
-- que abusa: frena al que tiene razón, y le enseña a elegir el motivo que sí
-- pasa. Ahí el dato queda mintiendo, que es peor que no tenerlo.
--
-- Entonces el control es de FORMA y no de grado: qué motivos existen, y en qué
-- dirección puede ir cada uno. Nada de eso depende de un número que el sistema
-- de origen pueda traer mal.
--
-- ── La tabla de decisión, que son las tres frases del usuario ─────────────
--
--   origen        destino     motivos
--   ───────────── ─────────── ──────────────────────────────────────────────
--   una sala      Bodega      Próximo a vencer · Baja rotación   (usos 1 y 2)
--   Bodega        una sala    Producto nuevo   · Baja rotación   (usos 3 y 2)
--   una sala      otra sala   NINGUNO — eso es una solicitud
--
-- «Producto nuevo» sólo puede salir de Bodega y «Próximo a vencer» sólo puede
-- ir a Bodega: las dos salen solas de la tabla, sin una regla aparte. Y el uso
-- 2 —producto de baja rotación que termina en otra sala— sigue existiendo, pero
-- en DOS tramos: sala → Bodega → sala. Bodega es la que decide a dónde va, que
-- es exactamente lo que se estaba pidiendo.
--
-- ── El momento ────────────────────────────────────────────────────────────
--
-- Se aprieta hoy porque en producción hay CERO envíos: el circuito se construyó
-- el 22-ago y todavía no lo usó nadie. Cambiar la regla antes de que exista la
-- costumbre cuesta una migración; hacerlo después es quitarle a la gente algo
-- que ya usa.
SET lock_timeout = '5s';

-- ── 1. Los tres motivos, y nada más ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.motivos_envio()
 RETURNS text[] LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT ARRAY['Próximo a vencer','Baja rotación','Producto nuevo'];
$function$;

COMMENT ON FUNCTION public.motivos_envio() IS
  'Los tres motivos por los que se empuja producto, uno por cada uso que el usuario reconoció el 2026-08-24. Lo demás es una solicitud. Ver la migración envios_tres_motivos_y_solo_bodega_manda_a_una_sala.';

-- ── 2. Y cuáles valen en cada dirección ───────────────────────────────────
--
-- Existe como función y no como un `CASE` adentro del trigger porque la
-- pantalla necesita hacer la MISMA pregunta para ofrecer sólo lo que se puede:
-- un motivo que se ofrece y después rebota es peor que uno que nunca se
-- ofreció. La que MANDA sigue siendo el trigger; ésta es para que las dos
-- respuestas salgan de un solo sitio.
CREATE OR REPLACE FUNCTION public.motivos_envio_por_destino(p_destino_es_bodega boolean)
 RETURNS text[] LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN coalesce(p_destino_es_bodega, false)
              -- Hacia Bodega: lo que una sala se saca de encima.
              THEN ARRAY['Próximo a vencer','Baja rotación']
              -- Hacia una sala: sólo puede venir de Bodega, y es reparto.
              ELSE ARRAY['Producto nuevo','Baja rotación']
         END;
$function$;

REVOKE EXECUTE ON FUNCTION public.motivos_envio_por_destino(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.motivos_envio_por_destino(boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.motivos_envio_por_destino(boolean) IS
  'Qué motivos de envío valen según a dónde va. La pantalla la usa para ofrecer sólo lo posible; el trigger validar_envio_producto la usa para decidir.';

-- ── 3. Y el trigger lo cobra ──────────────────────────────────────────────
--
-- Idéntico al de 20260823222500 salvo por el bloque «la dirección», marcado
-- abajo. Se reescribe entero porque CREATE OR REPLACE no admite parches.
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
    v_org_bod   boolean;
    v_dst_bod   boolean;
    v_org_nom   text;
    v_dst_nom   text;
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

    -- ── La dirección: sólo Bodega le manda a una sala ─────────────────────
    --
    -- Éste es el freno que faltaba, y es el único que separa un envío de una
    -- solicitud. Una sala que le empuja producto a otra está decidiendo por
    -- ella: el producto sale ANTES de que nadie del otro lado opine, así que
    -- «te lo mando porque lo necesitás» es una suposición que llega en caja.
    -- Cuando la otra sala de verdad lo necesita, lo PIDE — y ahí quien lo
    -- tiene decide antes de que se mueva nada.
    --
    -- El producto de baja rotación sigue llegando a otra sala: sala → Bodega,
    -- y Bodega reparte. Es un tramo más y es a propósito, porque el que
    -- reparte es el que ve las siete salas.
    IF NOT v_org_bod AND NOT v_dst_bod THEN
        RAISE EXCEPTION 'Una sala no le manda producto a otra sala. Lo que % ya no necesita va a Bodega, y Bodega decide si le toca a %. Si % lo necesita, que lo pida.',
            v_org_nom, v_dst_nom, v_dst_nom;
    END IF;

    -- Y el motivo tiene que corresponderse con la dirección: «Producto nuevo»
    -- sólo sale de Bodega y «Próximo a vencer» sólo llega a Bodega. Las dos
    -- reglas caen solas de acá, sin escribirlas aparte.
    IF NOT (v_motivo = ANY (public.motivos_envio_por_destino(v_dst_bod))) THEN
        RAISE EXCEPTION 'Un envío hacia % se manda por %. «%» no vale en esa dirección.',
            CASE WHEN v_dst_bod THEN 'Bodega' ELSE 'una sala' END,
            array_to_string(public.motivos_envio_por_destino(v_dst_bod), ' o '),
            v_motivo;
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
