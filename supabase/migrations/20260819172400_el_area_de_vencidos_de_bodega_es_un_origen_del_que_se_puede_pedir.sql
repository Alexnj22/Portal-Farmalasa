-- El área de vencidos de Bodega pasa a ser un origen del que SÍ se puede pedir.
--
-- Pedido del usuario el 2026-08-19: «que se pueda solicitar los productos que
-- tiene bodega en la bodega de vencidos. ahora no lo permite».
--
-- ── Por qué el nombre engaña, y por qué eso importa ────────────────────────
-- «Bodega de vencidos» es la ubicación 2 del sistema de origen, y NO es un
-- depósito de producto vencido: es el estante donde Bodega aparta lo que está
-- PRÓXIMO a vencer. Medido el 2026-08-19 sobre sus 89 renglones con existencia:
-- 75 están vigentes (el más próximo vence el 1-sep), 12 no llevan fecha y sólo
-- **2** están vencidos de verdad. O sea que el portal estaba escondiendo 175
-- unidades de producto vendible detrás de un rótulo, y la única salida que les
-- dejaba era esperar a que se vencieran.
--
-- Hasta hoy tres piezas lo negaban a la vez, y las tres tenían que cambiar o el
-- circuito se cortaba en la primera:
--
--   1. `get_donde_hay` no lo ofrecía como origen — la pantalla ni lo nombraba.
--   2. `validar_solicitud_traslado` medía contra `v_inventario_disponible`, que
--      filtra `is_vencidos = false`: la solicitud rebotaba con «la sala de
--      origen no tiene N unidades» aunque estuvieran ahí, a la vista.
--   3. La ubicación de origen del despacho salía de «la que NO es de vencidos»,
--      así que aunque la solicitud hubiera nacido, el producto habría salido
--      del estante equivocado. Eso vive en la Edge Function y va aparte.
--
-- ── El área es un ORIGEN, no una sala ─────────────────────────────────────
-- `origen_erp_sucursal_id` sigue siendo 6 (Bodega) y se agrega
-- `origen_vencidos: true` en el metadata. Es lo que deja intactos el aprobador
-- —la cascada turno → jefatura → Supervisión de Bodega—, el RLS, la sala de
-- respaldo y las listas: quien confirma es Bodega, igual que con cualquier otro
-- traslado. Lo único que cambia de área es de qué estante sale.
--
-- Convertirla en una sucursal más habría sido lo contrario: una sala nueva sin
-- gente, sin horario y sin quién le apruebe nada.
--
-- ── Y las dos existencias no se pueden sumar ni mezclar ────────────────────
-- Son dos estantes distintos del sistema de origen y se sincronizan por
-- separado (dos corridas por minuto, `inventory_sync_log.is_vencidos`). Por eso
-- hay dos vistas y dos «en vuelo»: un traslado que salió del área de vencidos
-- descontado del área normal deja a Bodega figurando con menos de lo que tiene,
-- y al revés deja que se pida dos veces lo mismo.

SET lock_timeout = '5s';

-- ── 1 · «En vuelo» pasa a ser por ÁREA ────────────────────────────────────
-- Lo que ya salió del sistema y el sync todavía no reflejó. Se parte en dos
-- porque desde hoy un traslado puede salir de cualquiera de los dos estantes, y
-- el corte de frescura de cada uno es el de SU propia corrida de sincronización.
--
-- La firma no cambia a propósito: `v_inventario_disponible` la nombra con lista
-- de columnas y cambiarla obligaría a tirar la vista y todo lo que cuelga.
CREATE OR REPLACE FUNCTION public.traslados_en_vuelo()
 RETURNS TABLE(erp_sucursal_id integer, erp_product_id integer, unidades numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH ultima AS (
        -- El margen va acá y no en la comparación para que se lea una sola vez
        -- qué significa: «el sistema se leyó, como muy tarde, 15 s antes de que
        -- lo anotáramos».
        SELECT m.erp_sucursal_id AS suc, u.at
        FROM public.erp_sucursal_map m
        CROSS JOIN LATERAL (
            SELECT max(l.synced_at) - interval '15 seconds' AS at
            FROM public.inventory_sync_log l
            WHERE l.erp_sucursal_id = m.erp_sucursal_id
              AND l.success AND l.is_vencidos = false
        ) u
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
      -- Lo que salió del área de vencidos no bajó el estante normal.
      AND NOT coalesce((a.metadata->>'origen_vencidos')::boolean, false)
    GROUP BY 1, 2;
$function$;

CREATE OR REPLACE FUNCTION public.traslados_en_vuelo_vencidos()
 RETURNS TABLE(erp_sucursal_id integer, erp_product_id integer, unidades numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH ultima AS (
        SELECT m.erp_sucursal_id AS suc, u.at
        FROM public.erp_sucursal_map m
        CROSS JOIN LATERAL (
            SELECT max(l.synced_at) - interval '15 seconds' AS at
            FROM public.inventory_sync_log l
            WHERE l.erp_sucursal_id = m.erp_sucursal_id
              AND l.success AND l.is_vencidos = true
        ) u
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
      AND coalesce((a.metadata->>'origen_vencidos')::boolean, false)
    GROUP BY 1, 2;
$function$;

REVOKE EXECUTE ON FUNCTION public.traslados_en_vuelo_vencidos() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.traslados_en_vuelo_vencidos() TO authenticated, service_role;

-- ── 2 · La existencia del área de vencidos, con lo que ya salió descontado ──
-- Gemela de `v_inventario_disponible`, y escrita igual a propósito: son la
-- misma cuenta sobre dos estantes. El factor sale de `v_inventario_lotes` —el
-- catálogo resuelve la etiqueta y `detalle` desempata—, nunca deducido acá.
CREATE OR REPLACE VIEW public.v_inventario_disponible_vencidos
WITH (security_invoker = true) AS
 WITH crudo AS (
         SELECT l.erp_product_id,
            l.erp_sucursal_id,
            sum(l.cantidad * l.factor)::numeric AS unidades
           FROM public.v_inventario_lotes l
          WHERE l.is_vencidos = true AND l.cantidad > 0
          GROUP BY l.erp_product_id, l.erp_sucursal_id
        )
 SELECT c.erp_product_id,
    c.erp_sucursal_id,
    c.unidades AS unidades_sistema,
    COALESCE(v.unidades, 0::numeric) AS en_vuelo,
    GREATEST(c.unidades - COALESCE(v.unidades, 0::numeric), 0::numeric) AS unidades
   FROM crudo c
     LEFT JOIN public.traslados_en_vuelo_vencidos() v(erp_sucursal_id, erp_product_id, unidades)
       ON v.erp_product_id = c.erp_product_id AND v.erp_sucursal_id = c.erp_sucursal_id;

REVOKE ALL ON public.v_inventario_disponible_vencidos FROM anon;
GRANT SELECT ON public.v_inventario_disponible_vencidos TO authenticated, service_role;

-- ── 3 · «Dónde hay» nombra el área como un origen más ──────────────────────
-- Va SIEMPRE al final de la lista, aunque tenga más unidades que las salas: el
-- orden de esta lista es el orden en que conviene pedir, y de un estante de
-- producto próximo a vencer se pide cuando se decide pedirlo, no por descarte.
--
-- El rótulo lleva el área adentro («Bodega · Área de Vencidos») porque ese
-- mismo texto es el que la solicitud guarda en `origen_branch_name`, y de ahí
-- lo leen la tarjeta, el historial y el aviso. Escribirlo acá es lo que hace
-- que las cinco pantallas digan de qué estante salió sin tocar ninguna.
CREATE OR REPLACE FUNCTION public.get_donde_hay(
    p_erp_product_id integer,
    p_erp_sucursal_destino integer
)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
    WITH origenes AS (
        SELECT d.erp_sucursal_id, d.unidades, false AS vencidos
        FROM public.v_inventario_disponible d
        WHERE d.erp_product_id = p_erp_product_id
          AND d.unidades > 0
          AND d.erp_sucursal_id <> p_erp_sucursal_destino
        UNION ALL
        SELECT d.erp_sucursal_id, d.unidades, true
        FROM public.v_inventario_disponible_vencidos d
        WHERE d.erp_product_id = p_erp_product_id
          AND d.unidades > 0
          AND d.erp_sucursal_id <> p_erp_sucursal_destino
    )
    SELECT coalesce(json_agg(x ORDER BY orden_area, orden_uds DESC), '[]'::json)
    FROM (
        SELECT json_build_object(
                   'sala',            coalesce(m.nombre, 'Sucursal ' || o.erp_sucursal_id)
                                      || CASE WHEN o.vencidos THEN ' · Área de Vencidos' ELSE '' END,
                   'unidades',        o.unidades::integer,
                   -- El mínimo es del estante de operación: el área de vencidos
                   -- no tiene uno que defender, ahí no se repone nada.
                   'minimo',          CASE WHEN o.vencidos THEN 0
                                           ELSE coalesce(sp.manual_min, sp.calc_min, sp.min_units, 0) END,
                   'vence',           v.primero,
                   'erp_sucursal_id', o.erp_sucursal_id,
                   'branch_id',       m.branch_id,
                   'vencidos',        o.vencidos
               ) AS x,
               o.vencidos::integer AS orden_area,
               o.unidades          AS orden_uds
        FROM origenes o
        LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = o.erp_sucursal_id
        LEFT JOIN public.product_stock_params sp
               ON sp.erp_product_id = p_erp_product_id
              AND sp.erp_sucursal_id = o.erp_sucursal_id
        LEFT JOIN LATERAL (
            SELECT min(i.fecha_vencimiento) AS primero
            FROM public.inventory i
            WHERE i.erp_product_id = p_erp_product_id
              AND i.erp_sucursal_id = o.erp_sucursal_id
              AND i.is_vencidos = o.vencidos
              AND i.cantidad > 0
              AND i.fecha_vencimiento IS NOT NULL
        ) v ON true
    ) t;
$$;

REVOKE EXECUTE ON FUNCTION public.get_donde_hay(integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_donde_hay(integer, integer) TO authenticated, service_role;

-- ── 4 · La validación mide contra el estante que la solicitud nombra ───────
CREATE OR REPLACE FUNCTION public.validar_solicitud_traslado()
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
    v_venc      boolean := coalesce((m->>'origen_vencidos')::boolean, false);
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

    -- Sólo Bodega tiene área de vencidos. Pedirle a una sala que no la tiene un
    -- traslado «de vencidos» produciría un despacho sin ubicación de origen, y
    -- eso se descubre recién al apretar el botón del otro lado: se corta acá.
    IF v_venc AND NOT EXISTS (
        SELECT 1 FROM public.erp_sucursal_map m2,
                      jsonb_array_elements(coalesce(m2.inv_ubicaciones, '[]'::jsonb)) u
         WHERE m2.erp_sucursal_id = v_org_erp
           AND coalesce((u->>'isVencidos')::boolean, false)
    ) THEN
        RAISE EXCEPTION 'La sala de origen % no tiene área de vencidos.', v_org_erp;
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
        -- Y sale del estante que la solicitud nombra: medir el área de vencidos
        -- contra la existencia normal es lo que rebotaba estas solicitudes.
        IF v_venc THEN
            SELECT coalesce(d.unidades, 0) INTO v_tiene
              FROM public.v_inventario_disponible_vencidos d
             WHERE d.erp_product_id = v_prod AND d.erp_sucursal_id = v_org_erp;
        ELSE
            SELECT coalesce(d.unidades, 0) INTO v_tiene
              FROM public.v_inventario_disponible d
             WHERE d.erp_product_id = v_prod AND d.erp_sucursal_id = v_org_erp;
        END IF;

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
$function$;

-- ── 5 · «¿Sigue habiendo?» también lee el estante correcto ─────────────────
-- Es lo que ve quien va a confirmar: entre que se pidió y se contesta, el
-- producto pudo venderse o salir en otro traslado. Si mirara el estante normal,
-- diría «ya no hay» sobre un área que sí tiene — o peor, «hay» sobre una que no.
--
-- Las ALTERNATIVAS siguen saliendo del estante de operación de las otras salas:
-- son a quién más pedirle, y ahí lo que corresponde ofrecer es producto de
-- rotación normal.
CREATE OR REPLACE FUNCTION public.get_traslado_disponibilidad(p_request_id uuid)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH sol AS (
        SELECT nullif(a.metadata->>'origen_erp_sucursal_id','')::integer AS origen,
               nullif(a.metadata->>'erp_sucursal_id','')::integer        AS destino,
               nullif(a.metadata->>'origen_branch_id','')::integer       AS origen_bid,
               a.metadata->>'origen_branch_name'                         AS origen_nombre,
               coalesce((a.metadata->>'origen_vencidos')::boolean,false) AS origen_venc,
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
    -- El estante del origen: el de vencidos cuando la solicitud lo nombra, el
    -- normal en todos los demás casos.
    stock_origen AS (
        SELECT d.unidades, d.en_vuelo
        FROM public.v_inventario_disponible_vencidos d CROSS JOIN sol
        WHERE d.erp_product_id = sol.prod AND d.erp_sucursal_id = sol.origen AND sol.origen_venc
        UNION ALL
        SELECT d.unidades, d.en_vuelo
        FROM public.v_inventario_disponible d CROSS JOIN sol
        WHERE d.erp_product_id = sol.prod AND d.erp_sucursal_id = sol.origen AND NOT sol.origen_venc
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
            'vencidos', sol.origen_venc,
            'unidades', coalesce(so.unidades, 0),
            'en_vuelo', coalesce(so.en_vuelo, 0),
            -- El área de vencidos no defiende un mínimo: ahí no se repone nada.
            'minimo',   CASE WHEN sol.origen_venc THEN 0 ELSE coalesce(mo.minimo, 0) END,
            'puede',    coalesce(so.unidades, 0) >= sol.pedido
        ),
        'respaldo', CASE
            WHEN sol.origen_bid IS NOT NULL
             AND sol.origen_bid = ANY (COALESCE(public.salas_que_cubro_ahora(), ARRAY[]::integer[]))
            THEN json_build_object('sala', coalesce(nullif(sol.origen_nombre, ''), 'La otra sala'))
            ELSE NULL
        END,
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
    LEFT JOIN stock_origen so ON true
    LEFT JOIN minimos mo ON mo.erp_sucursal_id = sol.origen;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_traslado_disponibilidad(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_traslado_disponibilidad(uuid) TO authenticated, service_role;

-- ── 6 · Una solicitud pendiente por producto Y POR ESTANTE ─────────────────
-- El índice frenaba dos solicitudes pendientes del mismo producto entre las
-- mismas dos salas, para que la cantidad se suba a la que ya existe en vez de
-- abrir otra. Con dos estantes en la misma sala, sin el área adentro, pedirle a
-- Bodega lo que tiene en el área de vencidos chocaría contra la solicitud del
-- estante normal — y el mensaje diría que ya se pidió algo que no se pidió.
DROP INDEX IF EXISTS public.approval_requests_un_traslado_pendiente;
CREATE UNIQUE INDEX approval_requests_un_traslado_pendiente
    ON public.approval_requests (
        ((metadata ->> 'erp_sucursal_id')),
        ((metadata ->> 'origen_erp_sucursal_id')),
        (coalesce(metadata ->> 'origen_vencidos', 'false')),
        ((((metadata -> 'items') -> 0) ->> 'erp_product_id'))
    )
    WHERE type = 'INVENTORY_TRANSFER_REQUEST' AND status = 'PENDING';
