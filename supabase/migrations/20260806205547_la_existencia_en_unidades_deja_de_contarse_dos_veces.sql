-- La existencia en unidades dejaba de cuadrar: se contaba DOS veces.
--
-- Lo destapó la prueba real del traslado, no la lectura. El sistema decía que
-- Salud 1 tenía 1,891 unidades de acetaminofén y el portal decía 3,701.
--
-- ── La causa ────────────────────────────────────────────────────────────────
-- `inventory.presentacion` guarda el NOMBRE del tipo («CAJA»), no un id. Para
-- llegar al factor había que pasar por `presentaciones` uniendo por ese nombre,
-- y hay productos con **dos presentaciones distintas llamadas igual**: el 2215
-- tiene CAJA con id 9 y CAJA con id 227, las dos de factor 100. Cada fila de
-- inventario en CAJA encontraba las dos, y el `sum()` la contaba dos veces.
--
-- Medido: **1,159 productos** con la combinación repetida y **1,023 con
-- existencia mal contada hoy**. No es un caso de borde.
--
-- ── El arreglo ──────────────────────────────────────────────────────────────
-- Un LATERAL que resuelve UN factor por (producto, tipo) en vez de un JOIN que
-- devuelve todos los que coincidan. De los 1,159, solo **3** tienen de verdad
-- factores distintos bajo el mismo nombre; para esos se toma el MENOR, que
-- subestima la existencia. Es el lado seguro: subestimar hace que una sala no
-- ceda producto que quizá tiene, y sobrestimar la hace prometer producto que no
-- tiene.
--
-- ── Lo que NO estaba en riesgo ──────────────────────────────────────────────
-- El movimiento contra el sistema. La Edge Function relee la existencia real
-- antes de escribir y compara contra esa, no contra este número — por eso la
-- prueba pasó con el traslado correcto pese al conteo inflado. Lo que estaba
-- mal era la lista de faltantes y la validación de la solicitud, las dos
-- demasiado permisivas.

SET lock_timeout = '5s';

-- ── 1 · La lista de faltantes ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_faltantes_con_stock_en_otra_sala(
    p_erp_sucursal_id integer,
    p_limite integer DEFAULT 40
)
RETURNS TABLE (
    erp_product_id integer,
    descripcion    text,
    min_units      integer,
    donde          jsonb
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
    WITH base AS (
        SELECT i.erp_product_id,
               i.erp_sucursal_id,
               max(i.descripcion)                                AS descripcion,
               sum(i.cantidad * coalesce(f.factor, 1))::integer  AS unidades
        FROM public.inventory i
        LEFT JOIN LATERAL (
            SELECT pp.factor
            FROM public.product_precios pp
            JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
            WHERE pp.product_id = i.erp_product_id
              AND upper(pr.tipo) = upper(i.presentacion)
              AND pp.activo
            ORDER BY pp.factor          -- el menor: subestimar es el lado seguro
            LIMIT 1
        ) f ON true
        WHERE i.is_vencidos = false AND i.cantidad > 0
        GROUP BY 1, 2
    ),
    mio AS (
        SELECT sp.erp_product_id,
               coalesce(sp.manual_min, sp.calc_min, sp.min_units) AS min_mio
        FROM public.product_stock_params sp
        WHERE sp.erp_sucursal_id = p_erp_sucursal_id
          AND coalesce(sp.manual_min, sp.calc_min, sp.min_units) > 0
    ),
    ajenas AS (
        SELECT b.erp_product_id, b.erp_sucursal_id, b.descripcion, b.unidades,
               coalesce(m.nombre, 'Sucursal ' || b.erp_sucursal_id) AS sala,
               m.branch_id
        FROM base b
        JOIN public.product_stock_params sp2
          ON sp2.erp_product_id = b.erp_product_id
         AND sp2.erp_sucursal_id = b.erp_sucursal_id
        LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = b.erp_sucursal_id
        WHERE b.erp_sucursal_id <> p_erp_sucursal_id
          AND b.unidades - 1 >= coalesce(sp2.manual_min, sp2.calc_min, sp2.min_units, 1)
    )
    SELECT a.erp_product_id,
           max(a.descripcion) AS descripcion,
           max(mio.min_mio)   AS min_units,
           jsonb_agg(jsonb_build_object(
                       'sala',            a.sala,
                       'unidades',        a.unidades,
                       'erp_sucursal_id', a.erp_sucursal_id,
                       'branch_id',       a.branch_id)
                     ORDER BY a.unidades DESC) AS donde
    FROM ajenas a
    JOIN mio ON mio.erp_product_id = a.erp_product_id
    WHERE NOT EXISTS (
        SELECT 1 FROM base b0
        WHERE b0.erp_product_id = a.erp_product_id
          AND b0.erp_sucursal_id = p_erp_sucursal_id
    )
    GROUP BY a.erp_product_id
    ORDER BY max(mio.min_mio) DESC, max(a.descripcion)
    LIMIT greatest(1, least(p_limite, 200));
$$;

REVOKE EXECUTE ON FUNCTION public.get_faltantes_con_stock_en_otra_sala(integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_faltantes_con_stock_en_otra_sala(integer, integer) TO authenticated, service_role;

-- ── 2 · La validación de la solicitud ───────────────────────────────────────
-- El mismo join estaba acá, y acá el efecto es peor: una sala parecía tener el
-- doble de lo que tiene, así que la regla de «que no quede debajo de su mínimo»
-- dejaba pasar traslados que sí la dejan debajo.
CREATE OR REPLACE FUNCTION public.validar_solicitud_traslado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    m           jsonb   := coalesce(NEW.metadata, '{}'::jsonb);
    v_items     jsonb   := m->'items';
    it          jsonb;
    v_org_erp   integer := nullif(m->>'origen_erp_sucursal_id', '')::integer;
    v_dst_erp   integer := nullif(m->>'erp_sucursal_id', '')::integer;
    v_org_bid   integer;
    v_prod      integer;
    v_unid      numeric;
    v_tiene     numeric;
    v_min       numeric;
    v_dest      uuid[];
    v_esc       text;
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_REQUEST' THEN RETURN NEW; END IF;

    IF nullif(btrim(coalesce(m->>'reason', NEW.note, '')), '') IS NULL THEN
        RAISE EXCEPTION 'La solicitud necesita decir para qué se pide.';
    END IF;

    IF v_org_erp IS NULL OR v_dst_erp IS NULL THEN
        RAISE EXCEPTION 'Falta la sala de origen o la de destino.';
    END IF;
    IF v_org_erp = v_dst_erp THEN
        RAISE EXCEPTION 'El origen y el destino son la misma sala.';
    END IF;

    SELECT branch_id INTO v_org_bid FROM public.erp_sucursal_map
     WHERE erp_sucursal_id = v_org_erp;
    IF v_org_bid IS NULL THEN
        RAISE EXCEPTION 'La sala de origen % no existe en el mapa.', v_org_erp;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map WHERE erp_sucursal_id = v_dst_erp) THEN
        RAISE EXCEPTION 'La sala de destino % no existe en el mapa.', v_dst_erp;
    END IF;

    IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION 'La solicitud no pide ni un producto.';
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

        v_unid := (it->>'cantidad')::numeric * (it->>'factor')::integer;

        -- UN factor por (producto, tipo). El JOIN de antes devolvía uno por cada
        -- presentación que se llamara igual, y sumaba la misma fila dos veces.
        SELECT coalesce(sum(i.cantidad * coalesce(f.factor, 1)), 0)
          INTO v_tiene
          FROM public.inventory i
          LEFT JOIN LATERAL (
              SELECT pp.factor
              FROM public.product_precios pp
              JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
              WHERE pp.product_id = i.erp_product_id
                AND upper(pr.tipo) = upper(i.presentacion)
                AND pp.activo
              ORDER BY pp.factor
              LIMIT 1
          ) f ON true
         WHERE i.erp_product_id = v_prod
           AND i.erp_sucursal_id = v_org_erp
           AND i.is_vencidos = false
           AND i.cantidad > 0;

        SELECT coalesce(sp.manual_min, sp.calc_min, sp.min_units, 0)
          INTO v_min
          FROM public.product_stock_params sp
         WHERE sp.erp_product_id = v_prod AND sp.erp_sucursal_id = v_org_erp;

        IF v_tiene < v_unid THEN
            RAISE EXCEPTION 'La sala de origen no tiene % unidades del producto % (tiene %).',
                v_unid, v_prod, v_tiene;
        END IF;

        IF v_tiene - v_unid < coalesce(v_min, 0) THEN
            RAISE EXCEPTION 'Ceder % unidades del producto % dejaría a la sala de origen debajo de su mínimo (% quedarían, mínimo %).',
                v_unid, v_prod, v_tiene - v_unid, v_min;
        END IF;
    END LOOP;

    SELECT r.destinatarios, r.escalon INTO v_dest, v_esc
      FROM public.resolver_destinatarios_traslado(v_org_bid) r;

    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN
        RAISE EXCEPTION 'No hay a quién pedirle el traslado en esa sala.';
    END IF;

    NEW.approver_id := v_dest[1];
    NEW.metadata := m
        || jsonb_build_object(
             'origen_branch_id', v_org_bid,
             'destinatarios',    to_jsonb(v_dest),
             'escalon_aviso',    v_esc);

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validar_solicitud_traslado() FROM PUBLIC, anon;
