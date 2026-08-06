-- Dos correcciones del usuario, el 2026-08-06.
--
-- ── 1 · El inventario del portal llega tarde ────────────────────────────────
-- «el inventario lo traemos del sistema cada minuto aprox: si se hace el
-- traslado, en el portal no se descuenta hasta que vuelve el JSON en unos
-- minutos, ¿y si otra sala pide en ese tiempo?»
--
-- Tiene razón y el hueco es real. Medido ahora: la última corrida del sync va
-- de 2 a 48 minutos de atraso según la sucursal. En esa ventana el portal
-- muestra existencia que ya salió de la sala, y la pantalla diría «puede» sobre
-- producto que no está.
--
-- No era peligroso —la aplicación relee la existencia real del sistema antes de
-- escribir, así que el despacho falla en vez de mover algo que no existe— pero
-- la pantalla mentía, y con eso se crean solicitudes que nacen condenadas.
--
-- La solución no es consultar el sistema en cada vista: es que **el portal
-- descuente lo que él mismo despachó y todavía no volvió**. Sabe exactamente
-- cuándo despachó cada traslado (`erp_traslado.at`) y cuándo corrió el último
-- sync de esa sucursal (`inventory_sync_log`). Lo que está en el medio, se
-- resta. Cuando el JSON vuelve, la resta se apaga sola.
--
-- Ojo con `inventory.synced_at`: NO sirve para esto. Solo se mueve cuando la
-- fila cambia —es la regla de la casa contra el churn de WAL— así que una sala
-- sin ventas tiene un `synced_at` viejo aunque el sync haya corrido hace un
-- minuto. El registro por corrida es `inventory_sync_log`.
--
-- ── 2 · El mínimo NO bloquea ────────────────────────────────────────────────
-- «no hay problema en que la sala B se quede a 0. Si A le pide 1 a B y B tiene
-- 3, y C le pide 2, lo puede hacer, B se queda a 0 sin problemas. El problema
-- es que A le pida 1 y C le pida 1 y B solo tenga 1.»
--
-- La regla anterior —que la sala de origen quedara por encima de su propio
-- mínimo— era mía y estaba de más: convertía un dato útil en un candado. Lo
-- único que importa es que **haya**. El mínimo se sigue calculando y se sigue
-- mostrando, pero informa, no impide.

SET lock_timeout = '5s';

-- ── El puente: lo despachado que el sync todavía no trajo ───────────────────
-- DEFINER porque tiene que ver TODAS las solicitudes: con el RLS puesto, cada
-- persona solo vería las suyas y la resta saldría corta justo para quien no
-- despachó — que es la mayoría. Devuelve cantidades por producto y sala, sin
-- nada de quién pidió.
CREATE OR REPLACE FUNCTION public.traslados_en_vuelo()
RETURNS TABLE (erp_sucursal_id integer, erp_product_id integer, unidades numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    WITH ultima AS (
        SELECT l.erp_sucursal_id::integer AS suc, max(l.synced_at) AS at
        FROM public.inventory_sync_log l
        WHERE l.success AND l.is_vencidos = false
        GROUP BY 1
    )
    SELECT (a.metadata->>'origen_erp_sucursal_id')::integer,
           (it->>'erp_product_id')::integer,
           sum(coalesce((it->>'cantidad')::numeric, 0) * coalesce((it->>'factor')::numeric, 1))
    FROM public.approval_requests a
    CROSS JOIN LATERAL jsonb_array_elements(a.metadata->'items') it
    LEFT JOIN ultima u ON u.suc = (a.metadata->>'origen_erp_sucursal_id')::integer
    WHERE a.type = 'INVENTORY_TRANSFER_REQUEST'
      AND a.status = 'APPROVED'
      AND a.metadata ? 'erp_traslado'
      AND (a.metadata->'erp_traslado'->>'at')::timestamptz > coalesce(u.at, '-infinity'::timestamptz)
    GROUP BY 1, 2;
$$;

REVOKE EXECUTE ON FUNCTION public.traslados_en_vuelo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.traslados_en_vuelo() TO authenticated, service_role;

-- ── La existencia disponible, en un solo lugar ──────────────────────────────
-- Las tres pantallas que preguntan «cuánto hay» tienen que contestar lo mismo.
-- Con tres copias de la cuenta, la primera que se corrija deja a las otras dos
-- contestando distinto — que fue exactamente lo que pasó con el doble conteo.
CREATE OR REPLACE VIEW public.v_inventario_disponible
WITH (security_invoker = true) AS
    WITH crudo AS (
        SELECT i.erp_product_id,
               i.erp_sucursal_id,
               sum(i.cantidad * coalesce(f.factor, 1))::numeric AS unidades
        FROM public.inventory i
        LEFT JOIN LATERAL (
            SELECT pp.factor FROM public.product_precios pp
            JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
            WHERE pp.product_id = i.erp_product_id
              AND upper(pr.tipo) = upper(i.presentacion) AND pp.activo
            ORDER BY pp.factor LIMIT 1
        ) f ON true
        WHERE i.is_vencidos = false AND i.cantidad > 0
        GROUP BY 1, 2
    )
    SELECT c.erp_product_id,
           c.erp_sucursal_id,
           c.unidades                              AS unidades_sistema,
           coalesce(v.unidades, 0)                 AS en_vuelo,
           greatest(c.unidades - coalesce(v.unidades, 0), 0) AS unidades
    FROM crudo c
    LEFT JOIN public.traslados_en_vuelo() v
           ON v.erp_product_id = c.erp_product_id
          AND v.erp_sucursal_id = c.erp_sucursal_id;

GRANT SELECT ON public.v_inventario_disponible TO authenticated, service_role;

-- ── 1 · La lista de faltantes ───────────────────────────────────────────────
-- Regla 3 corregida: alcanza con que la otra sala TENGA. Que quede en cero es
-- decisión de quien despacha, no del portal. El mínimo viaja igual, para que la
-- pantalla lo pueda decir.
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
        SELECT d.erp_product_id, d.erp_sucursal_id, d.unidades::integer AS unidades
        FROM public.v_inventario_disponible d
        WHERE d.unidades > 0
    ),
    nombres AS (
        SELECT i.erp_product_id, max(i.descripcion) AS descripcion
        FROM public.inventory i WHERE i.cantidad > 0 GROUP BY 1
    ),
    mio AS (
        SELECT sp.erp_product_id,
               coalesce(sp.manual_min, sp.calc_min, sp.min_units) AS min_mio
        FROM public.product_stock_params sp
        WHERE sp.erp_sucursal_id = p_erp_sucursal_id
          AND coalesce(sp.manual_min, sp.calc_min, sp.min_units) > 0
    ),
    ajenas AS (
        SELECT b.erp_product_id, b.erp_sucursal_id, b.unidades,
               coalesce(m.nombre, 'Sucursal ' || b.erp_sucursal_id) AS sala,
               m.branch_id,
               coalesce(sp2.manual_min, sp2.calc_min, sp2.min_units, 0) AS min_suyo
        FROM base b
        JOIN public.product_stock_params sp2
          ON sp2.erp_product_id = b.erp_product_id
         AND sp2.erp_sucursal_id = b.erp_sucursal_id
        LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = b.erp_sucursal_id
        WHERE b.erp_sucursal_id <> p_erp_sucursal_id
    )
    SELECT a.erp_product_id,
           max(n.descripcion) AS descripcion,
           max(mio.min_mio)   AS min_units,
           jsonb_agg(jsonb_build_object(
                       'sala',            a.sala,
                       'unidades',        a.unidades,
                       'minimo',          a.min_suyo,
                       'erp_sucursal_id', a.erp_sucursal_id,
                       'branch_id',       a.branch_id)
                     ORDER BY a.unidades DESC) AS donde
    FROM ajenas a
    JOIN mio ON mio.erp_product_id = a.erp_product_id
    LEFT JOIN nombres n ON n.erp_product_id = a.erp_product_id
    WHERE NOT EXISTS (
        SELECT 1 FROM base b0
        WHERE b0.erp_product_id = a.erp_product_id
          AND b0.erp_sucursal_id = p_erp_sucursal_id
    )
    GROUP BY a.erp_product_id
    ORDER BY max(mio.min_mio) DESC, max(n.descripcion)
    LIMIT greatest(1, least(p_limite, 200));
$$;

REVOKE EXECUTE ON FUNCTION public.get_faltantes_con_stock_en_otra_sala(integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_faltantes_con_stock_en_otra_sala(integer, integer) TO authenticated, service_role;

-- ── 2 · La disponibilidad de un traslado ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_traslado_disponibilidad(p_request_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
    WITH sol AS (
        SELECT nullif(a.metadata->>'origen_erp_sucursal_id','')::integer AS origen,
               nullif(a.metadata->>'erp_sucursal_id','')::integer        AS destino,
               (a.metadata->'items'->0->>'erp_product_id')::integer      AS prod,
               coalesce((a.metadata->'items'->0->>'cantidad')::numeric, 0)
                 * coalesce((a.metadata->'items'->0->>'factor')::numeric, 1) AS pedido
        FROM public.approval_requests a
        WHERE a.id = p_request_id AND a.type = 'INVENTORY_TRANSFER_REQUEST'
    ),
    stock AS (
        SELECT d.erp_sucursal_id, d.unidades, d.en_vuelo
        FROM public.v_inventario_disponible d CROSS JOIN sol
        WHERE d.erp_product_id = sol.prod
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
            -- Lo que ya salió y el sync todavía no trajo. Se expone para que la
            -- pantalla lo pueda decir: «quedan 2, y 1 ya salió».
            'en_vuelo', coalesce(so.en_vuelo, 0),
            'minimo',   coalesce(mo.minimo, 0),
            -- Solo importa que HAYA. Que la sala quede en cero es decisión de
            -- quien despacha, no del portal.
            'puede',    coalesce(so.unidades, 0) >= sol.pedido
        ),
        'alternativas', coalesce((
            SELECT json_agg(json_build_object(
                       'erp_sucursal_id', s.erp_sucursal_id,
                       'sala',            coalesce(m.nombre, 'Sucursal ' || s.erp_sucursal_id),
                       'unidades',        s.unidades,
                       'minimo',          coalesce(mi.minimo, 0))
                     ORDER BY s.unidades DESC)
            FROM stock s
            LEFT JOIN minimos mi ON mi.erp_sucursal_id = s.erp_sucursal_id
            LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = s.erp_sucursal_id
            WHERE s.erp_sucursal_id <> sol.origen
              AND s.erp_sucursal_id <> sol.destino
              AND s.unidades >= sol.pedido
        ), '[]'::json)
    )
    FROM sol
    LEFT JOIN stock   so ON so.erp_sucursal_id = sol.origen
    LEFT JOIN minimos mo ON mo.erp_sucursal_id = sol.origen;
$$;

REVOKE EXECUTE ON FUNCTION public.get_traslado_disponibilidad(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_traslado_disponibilidad(uuid) TO authenticated, service_role;

-- ── 3 · La validación de la solicitud ───────────────────────────────────────
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

        -- Lo disponible ya trae descontado lo que salió y el sync no trajo.
        SELECT coalesce(d.unidades, 0) INTO v_tiene
          FROM public.v_inventario_disponible d
         WHERE d.erp_product_id = v_prod AND d.erp_sucursal_id = v_org_erp;

        -- Y nada más: que la sala quede en cero es decisión de quien despacha.
        IF coalesce(v_tiene, 0) < v_unid THEN
            RAISE EXCEPTION 'La sala de origen no tiene % unidades del producto % (tiene %).',
                v_unid, v_prod, coalesce(v_tiene, 0);
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
