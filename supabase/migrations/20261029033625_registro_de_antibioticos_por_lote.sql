-- PENDIENTES 17 — Registro trazable de antibióticos por lote (Guía SRS 3.3/3.4,
-- CRÍTICOS; campos del 3.5: lote, vencimiento, cantidad dispensada, devuelta y
-- destruida, responsables).
--
-- Por sala y por mes: cada lote con su saldo inicial, cada movimiento (compra,
-- recibido, enviado, venta), el saldo que debería haber y el que hay. Todo en
-- UNIDADES MÍNIMAS (cápsula, tableta, ampolla) — es la única unidad en la que
-- las cuatro fuentes suman entre sí. Medido el 2026-10-28 contra la foto diaria
-- del inventario (octubre, 159 antibióticos, 7 sucursales): en las salas, 400 de
-- 428 producto-sala cuadran al unidad exacta; por lote en toda la red, 44 de 46
-- lotes comprados desde septiembre.
--
-- Qué fuente manda en cada número (medido, no supuesto):
--   · compra    — `purchase_receipt_items.cantidad` YA viene en unidades
--                 (precio unitario de la amoxicilina x30: $0.1786 = una cápsula).
--   · venta     — `cantidad × factor_unidades` (blíster 1x10 → 10).
--   · existencia— `inventory.cantidad × N` de su `detalle` «1xN»: la caja trae
--                 una fila por presentación (9 cajas + 2 blíster + 0 sueltas),
--                 la misma regla que `inventory_daily_snapshot`.
--   · traslado del portal (despachos de Bodega) — lote y cantidad del RENGLÓN
--                 del traslado que creó el portal (`pedido_traslado_linea
--                 .detalle.renglones` × «CAJA (N)»): 10,059 de 10,059 iguales al
--                 traslado del sistema. NO `lotes_asignados`: es lo que se
--                 PLANEÓ, y en 39 casos se mandó otra cantidad; tampoco
--                 `take × dispatch_factor`, que en 150 casos multiplicaba unidades.
--   · envío entre salas — `envio_linea.unidades` y el lote de `lotes`.
--   · traslado hecho fuera del portal — `traslados_erp_linea`: cantidad cierta,
--                 sin lote ni origen. OJO: ese espejo NO tiene los traslados del
--                 portal anteriores al 24-sep; por eso no es la fuente de los
--                 despachos.
--
-- Dos cuadres, y no son el mismo:
--   · por PRODUCTO, contra `inventory_daily` (foto diaria de cada producto):
--     independiente de cómo se escribió el lote. Octubre: 522 de 562.
--   · por LOTE: el saldo inicial sale de la foto POR LOTE que crea esta
--     migración (desde el 29-oct); antes de eso, sólo los lotes nacidos
--     después del 11-ago tienen historia completa. Los demás dicen
--     `sin_base` y no se inventa un saldo para ellos.

SET lock_timeout = '5s';

-- ── La foto diaria POR LOTE ─────────────────────────────────────────────────
-- `inventory_daily` guarda el total por producto: alcanza para cuadrar el
-- producto, no el lote. Esta foto es la que, desde el día que se instala, da un
-- saldo inicial independiente a cada lote — sin ella, el inicial de un lote
-- viejo sólo se puede deducir del final, y un saldo deducido cuadra siempre.
-- Sólo antibióticos (~730 filas por día). Historial regulatorio: no se purga.
CREATE TABLE public.antibioticos_lote_diario (
    fecha           date     NOT NULL,
    erp_sucursal_id smallint NOT NULL,
    erp_product_id  integer  NOT NULL,
    lote            text     NOT NULL,
    vencidos        boolean  NOT NULL DEFAULT false,
    vence           date,
    unidades        integer  NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (fecha, erp_sucursal_id, erp_product_id, lote, vencidos)
);
ALTER TABLE public.antibioticos_lote_diario ENABLE ROW LEVEL SECURITY;
CREATE POLICY antibioticos_lote_diario_select ON public.antibioticos_lote_diario
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('bitacoras_tab_antibioticos', 'can_view')));

CREATE OR REPLACE FUNCTION public.antibioticos_lote_foto(p_fecha date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_fecha date;
    v_filas integer;
BEGIN
    -- Corre a la 01:50 SV, después de `inventory_daily_snapshot`: la sala ya
    -- cerró y la foto describe el día ANTERIOR, en hora local.
    v_fecha := coalesce(p_fecha, ((now() AT TIME ZONE 'America/El_Salvador') - interval '1 day')::date);

    -- Idempotente: se reemplaza la foto entera (la ausencia de un lote también
    -- es información).
    DELETE FROM public.antibioticos_lote_diario WHERE fecha = v_fecha;

    INSERT INTO public.antibioticos_lote_diario
           (fecha, erp_sucursal_id, erp_product_id, lote, vencidos, vence, unidades)
    SELECT v_fecha, i.erp_sucursal_id, i.erp_product_id,
           coalesce(nullif(upper(btrim(i.lote)), ''), 'SIN LOTE'), i.is_vencidos,
           max(i.fecha_vencimiento),
           sum(i.cantidad * coalesce((regexp_match(i.detalle, '\d+[xX](\d+)'))[1]::int, 1))::int
      FROM public.inventory i
     WHERE i.erp_product_id = ANY(public.antibioticos_del_cuadre())
     GROUP BY 1, 2, 3, 4, 5
    HAVING sum(i.cantidad * coalesce((regexp_match(i.detalle, '\d+[xX](\d+)'))[1]::int, 1)) <> 0;

    GET DIAGNOSTICS v_filas = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'fecha', v_fecha, 'filas', v_filas);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.antibioticos_lote_foto(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.antibioticos_lote_foto(date) TO service_role;

-- ── El registro ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_registro_antibioticos_lote(p_branch_id bigint, p_periodo text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $fn$
DECLARE
    -- Desde el 11-ago los despachos guardan el lote: antes de esa fecha un
    -- traslado no dice qué lote llevó, así que el historial de un lote sólo es
    -- completo si el lote NACIÓ después (su primera compra en la red es de esa
    -- fecha en adelante).
    c_historia constant date := '2026-08-11';
    v_ini date; v_fin date; v_hoy date;
    v_erp int[]; v_ids int[];
    v_foto_ini boolean; v_foto_fin boolean; v_existencia text;
    v_hay_d_ini boolean; v_hay_d_fin boolean;
    v_out json;
BEGIN
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');
    IF NOT (SELECT public.auth_has_module_permission('bitacoras_tab_antibioticos', 'can_view')) THEN
        RAISE EXCEPTION 'Tu cargo no tiene la pestana de antibioticos.' USING ERRCODE = '42501';
    END IF;
    IF p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Periodo invalido: se espera YYYY-MM.' USING ERRCODE = 'P0001';
    END IF;

    v_hoy := public.bitacora_hoy_sv();
    v_ini := to_date(p_periodo || '-01', 'YYYY-MM-DD');
    IF v_ini > v_hoy THEN
        RAISE EXCEPTION 'Ese mes todavia no empezo.' USING ERRCODE = 'P0001';
    END IF;
    v_fin := least((v_ini + interval '1 month - 1 day')::date, v_hoy);
    SELECT array_agg(m.erp_sucursal_id) INTO v_erp FROM public.erp_sucursal_map m WHERE m.branch_id = p_branch_id;
    IF v_erp IS NULL THEN
        RAISE EXCEPTION 'Esa sucursal no tiene inventario.' USING ERRCODE = 'P0001';
    END IF;
    v_ids := public.antibioticos_del_cuadre();

    v_foto_ini := EXISTS (SELECT 1 FROM public.antibioticos_lote_diario d
                           WHERE d.fecha = v_ini - 1 AND d.erp_sucursal_id = ANY(v_erp));
    -- La existencia del cierre: si el mes es el corriente, la de ahora; si ya
    -- pasó, la foto de su último día. Sin foto no hay contra qué cuadrar.
    IF v_fin = v_hoy THEN
        v_existencia := 'ahora';
    ELSE
        v_foto_fin := EXISTS (SELECT 1 FROM public.antibioticos_lote_diario d
                               WHERE d.fecha = v_fin AND d.erp_sucursal_id = ANY(v_erp));
        v_existencia := CASE WHEN v_foto_fin THEN 'foto' END;
    END IF;

    v_hay_d_ini := EXISTS (SELECT 1 FROM public.inventory_daily d
                            WHERE d.fecha = v_ini - 1 AND d.erp_sucursal_id = ANY(v_erp));
    v_hay_d_fin := v_existencia = 'ahora' OR EXISTS (SELECT 1 FROM public.inventory_daily d
                            WHERE d.fecha = v_fin AND d.erp_sucursal_id = ANY(v_erp));

    WITH
    salas AS (SELECT m.erp_sucursal_id AS suc, m.nombre FROM public.erp_sucursal_map m),
    -- Los despachos que hizo el portal: el lote y la cantidad salen del
    -- RENGLÓN del traslado que el portal creó (`detalle.renglones`, en la
    -- presentación de `detalle.presentacion`, «CAJA (30)»). Medido el
    -- 2026-10-28: 10,059 de 10,059 iguales al traslado del sistema. Es la fuente
    -- y no `traslados_erp_linea` porque ese espejo NO tiene los traslados del
    -- portal anteriores al 24-sep (15,596 renglones del 11-ago al 24-sep).
    ped AS (
        SELECT ptl.id_traslado::int AS idt, ptl.erp_product_id AS pid,
               ptl.erp_sucursal_id AS dst, 6 AS ori,
               (ptl.enviado_at AT TIME ZONE 'America/El_Salvador')::date AS f_portal,
               nullif(upper(btrim(r->>'lote')), '') AS lote,
               (r->>'cantidad')::numeric * (regexp_match(ptl.detalle->>'presentacion', '\((\d+)\)'))[1]::int AS u,
               coalesce(ptl.recibido_por, pi.received_by) AS recibio, pi.enviado_por AS envio
          FROM public.pedido_traslado_linea ptl
          JOIN public.pedido_items pi ON pi.id = ptl.pedido_item_id
          CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(ptl.detalle->'renglones') = 'array' THEN ptl.detalle->'renglones' ELSE '[]'::jsonb END) r
         WHERE ptl.id_traslado ~ '^\d+$' AND ptl.erp_product_id = ANY(v_ids)
           AND ptl.enviado_at >= c_historia AND (ptl.erp_sucursal_id = ANY(v_erp) OR 6 = ANY(v_erp))
    ),
    -- Los envíos entre salas. La cantidad es `unidades` del renglón (coincide
    -- con el traslado del sistema); el lote, de `lotes`. En 7 renglones los
    -- lotes no suman lo enviado: con un solo lote, ese lote se lleva todo; con
    -- varios, se reparte y queda marcado `aproximado`.
    env0 AS (
        SELECT e.id, e.id_traslado, e.id_traslado_devolucion, e.erp_product_id AS pid, e.unidades AS total,
               (ar.metadata->>'origen_erp_sucursal_id')::int AS ori, (ar.metadata->>'erp_sucursal_id')::int AS dst,
               (e.enviado_at AT TIME ZONE 'America/El_Salvador')::date AS f_env,
               (e.devuelto_at AT TIME ZONE 'America/El_Salvador')::date AS f_dev,
               e.decidido_por AS recibio, ar.employee_id AS envio,
               nullif(upper(btrim(l->>'lote')), '') AS lote, nullif(l->>'vence', '')::date AS vence,
               (l->>'unidades')::numeric AS peso,
               sum((l->>'unidades')::numeric) OVER (PARTITION BY e.id) AS peso_total,
               count(*) OVER (PARTITION BY e.id) AS n_lotes,
               row_number() OVER (PARTITION BY e.id ORDER BY (l->>'unidades')::numeric DESC, l->>'lote') AS orden
          FROM public.envio_linea e
          JOIN public.approval_requests ar ON ar.id = e.request_id
          CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(e.lotes) = 'array' THEN e.lotes ELSE '[]'::jsonb END) l
         WHERE e.id_traslado ~ '^\d+$' AND e.erp_product_id = ANY(v_ids) AND e.enviado_at >= c_historia
    ),
    env1 AS (
        SELECT x.*,
               CASE WHEN x.n_lotes = 1 OR x.peso_total = x.total THEN
                         CASE WHEN x.n_lotes = 1 THEN x.total ELSE x.peso END
                    ELSE floor(x.peso * x.total / x.peso_total)
                         + CASE WHEN x.orden = 1
                                THEN x.total - (SELECT sum(floor(y.peso * x.total / y.peso_total)) FROM env0 y WHERE y.id = x.id)
                                ELSE 0 END
               END AS u,
               (x.n_lotes > 1 AND x.peso_total <> x.total) AS aproximado
          FROM env0 x
    ),
    -- Los traslados del sistema que no hizo el portal: la cantidad es cierta,
    -- el lote y el origen no se conocen. Entran a la sala de destino sin lote.
    tr_fuera AS (
        SELECT t.id_traslado AS idt, t.erp_product_id AS pid, t.erp_sucursal_destino AS dst,
               min(t.fecha) AS fecha, sum(t.unidad * t.cantidad) AS u
          FROM public.traslados_erp_linea t
         WHERE t.fecha BETWEEN c_historia AND v_fin AND t.erp_product_id = ANY(v_ids)
           AND t.erp_sucursal_destino = ANY(v_erp)
           AND NOT EXISTS (SELECT 1 FROM public.pedido_traslado_linea p
                            WHERE p.id_traslado = t.id_traslado::text AND p.erp_product_id = t.erp_product_id)
           AND NOT EXISTS (SELECT 1 FROM public.envio_linea e
                            WHERE (e.id_traslado = t.id_traslado::text OR e.id_traslado_devolucion = t.id_traslado::text)
                              AND e.erp_product_id = t.erp_product_id)
         GROUP BY 1, 2, 3
    ),
    -- Cuántos traslados hechos fuera del portal tocaron esta sucursal desde
    -- que hay historia: no dicen qué lote llevaron, así que son la explicación
    -- más probable de una diferencia POR LOTE cuando el producto entero cuadra.
    -- En la Bodega, que despacha, cuentan los que fueron a cualquier sala.
    fuera_hint AS (
        SELECT t.erp_product_id AS pid, count(DISTINCT t.id_traslado) AS n
          FROM public.traslados_erp_linea t
         WHERE t.fecha BETWEEN c_historia AND v_fin AND t.erp_product_id = ANY(v_ids)
           AND (t.erp_sucursal_destino = ANY(v_erp) OR (6 = ANY(v_erp) AND t.erp_sucursal_destino <> 6))
           AND NOT EXISTS (SELECT 1 FROM public.pedido_traslado_linea p
                            WHERE p.id_traslado = t.id_traslado::text AND p.erp_product_id = t.erp_product_id)
           AND NOT EXISTS (SELECT 1 FROM public.envio_linea e
                            WHERE (e.id_traslado = t.id_traslado::text OR e.id_traslado_devolucion = t.id_traslado::text)
                              AND e.erp_product_id = t.erp_product_id)
         GROUP BY 1
    ),
    -- La fecha de un traslado es la del sistema cuando la tiene (es cuando se
    -- movió la existencia); si no, la del portal.
    tr_fecha AS (
        SELECT t.id_traslado AS idt, t.erp_product_id AS pid, min(t.fecha) AS fecha
          FROM public.traslados_erp_linea t
         WHERE t.fecha >= c_historia AND t.erp_product_id = ANY(v_ids)
         GROUP BY 1, 2
    ),
    tr_lote AS (
        SELECT p.idt, p.pid, p.dst, p.ori, coalesce(tf.fecha, p.f_portal) AS fecha, p.lote, NULL::date AS vence,
               p.u, p.recibio, p.envio, false AS aproximado
          FROM ped p LEFT JOIN tr_fecha tf ON tf.idt = p.idt AND tf.pid = p.pid
         WHERE p.u > 0
        UNION ALL
        SELECT e.id_traslado::int, e.pid, e.dst, e.ori, coalesce(tf.fecha, e.f_env), e.lote, e.vence,
               e.u, e.recibio, e.envio, e.aproximado
          FROM env1 e LEFT JOIN tr_fecha tf ON tf.idt = e.id_traslado::int AND tf.pid = e.pid
         WHERE e.u > 0
        UNION ALL
        -- La devolución de un envío hace el camino inverso.
        SELECT e.id_traslado_devolucion::int, e.pid, e.ori, e.dst,
               coalesce(tf.fecha, e.f_dev, e.f_env), e.lote, e.vence, e.u, NULL, e.recibio, e.aproximado
          FROM env1 e LEFT JOIN tr_fecha tf ON tf.idt = e.id_traslado_devolucion::int AND tf.pid = e.pid
         WHERE e.id_traslado_devolucion ~ '^\d+$' AND e.u > 0
    ),
    mov AS (
        -- Compras de la sala.
        SELECT it.erp_product_id AS pid, nullif(upper(btrim(it.lote)), '') AS lote,
               it.fecha_vencimiento AS vence, r.fecha, 'compra'::text AS tipo,
               it.cantidad::numeric AS u,
               concat_ws(' ', r.documento_tipo, r.documento_numero) AS documento,
               r.proveedor AS detalle, NULL::uuid AS quien, NULL::text AS cod_vendedor, false AS aproximado
          FROM public.purchase_receipt_items it
          JOIN public.purchase_receipts r ON r.id = it.receipt_id
         WHERE r.branch_id = p_branch_id AND r.fecha BETWEEN c_historia AND v_fin
           AND r.estado IS DISTINCT FROM 'anulada' AND it.erp_product_id = ANY(v_ids)
        UNION ALL
        -- Lo que entró por traslado.
        SELECT tl.pid, tl.lote, tl.vence, tl.fecha, 'recibido', tl.u, 'Traslado ' || tl.idt,
               'De ' || (SELECT s.nombre FROM salas s WHERE s.suc = tl.ori),
               tl.recibio, NULL, tl.aproximado
          FROM tr_lote tl WHERE tl.dst = ANY(v_erp) AND tl.fecha BETWEEN c_historia AND v_fin
        UNION ALL
        -- Lo que salió por traslado.
        SELECT tl.pid, tl.lote, tl.vence, tl.fecha, 'enviado', -tl.u, 'Traslado ' || tl.idt,
               'A ' || (SELECT s.nombre FROM salas s WHERE s.suc = tl.dst),
               tl.envio, NULL, tl.aproximado
          FROM tr_lote tl WHERE tl.ori = ANY(v_erp) AND tl.fecha BETWEEN c_historia AND v_fin
        UNION ALL
        -- Traslados hechos fuera del portal: sin lote.
        SELECT tf.pid, NULL, NULL, tf.fecha, 'recibido_sin_lote', tf.u, 'Traslado ' || tf.idt,
               NULL, NULL, NULL, false
          FROM tr_fuera tf
        UNION ALL
        -- Ventas.
        SELECT ii.erp_product_id, nullif(upper(btrim(ii.lote)), ''), ii.fecha_vencimiento, si.fecha, 'venta',
               -(ii.cantidad * coalesce(ii.factor_unidades, 1)),
               concat_ws(' ', si.tipo_documento, si.erp_invoice_id), NULL, NULL, si.cod_vendedor, false
          FROM public.sales_invoice_items ii
          JOIN public.sales_invoices si ON si.id = ii.invoice_id
         WHERE si.branch_id = p_branch_id AND si.fecha BETWEEN c_historia AND v_fin
           AND public.venta_valida(si.estado) AND ii.erp_product_id = ANY(v_ids)
    ),
    mov_k AS (
        SELECT m.*, coalesce(m.lote, 'SIN LOTE') AS k FROM mov m
    ),
    -- Primera compra del lote en TODA la red: decide si su historia está entera.
    nacimiento AS (
        SELECT it.erp_product_id AS pid, upper(btrim(it.lote)) AS k, min(r.fecha) AS nacio
          FROM public.purchase_receipt_items it
          JOIN public.purchase_receipts r ON r.id = it.receipt_id
         WHERE it.erp_product_id = ANY(v_ids) AND nullif(btrim(it.lote), '') IS NOT NULL
         GROUP BY 1, 2
    ),
    foto_ini AS (
        SELECT d.erp_product_id AS pid, d.lote AS k, sum(d.unidades) AS u, max(d.vence) AS vence
          FROM public.antibioticos_lote_diario d
         WHERE v_foto_ini AND d.fecha = v_ini - 1 AND d.erp_sucursal_id = ANY(v_erp)
         GROUP BY 1, 2
    ),
    existe AS (
        SELECT i.erp_product_id AS pid, coalesce(nullif(upper(btrim(i.lote)), ''), 'SIN LOTE') AS k,
               sum(i.cantidad * coalesce((regexp_match(i.detalle, '\d+[xX](\d+)'))[1]::int, 1)) AS u,
               sum(i.cantidad * coalesce((regexp_match(i.detalle, '\d+[xX](\d+)'))[1]::int, 1))
                   FILTER (WHERE i.is_vencidos) AS u_vencidos,
               max(i.fecha_vencimiento) AS vence
          FROM public.inventory i
         WHERE v_existencia = 'ahora' AND i.erp_sucursal_id = ANY(v_erp) AND i.erp_product_id = ANY(v_ids)
         GROUP BY 1, 2
        UNION ALL
        SELECT d.erp_product_id, d.lote, sum(d.unidades), sum(d.unidades) FILTER (WHERE d.vencidos), max(d.vence)
          FROM public.antibioticos_lote_diario d
         WHERE v_existencia = 'foto' AND d.fecha = v_fin AND d.erp_sucursal_id = ANY(v_erp)
         GROUP BY 1, 2
    ),
    -- Todo lo de un lote en UNA pasada sobre los movimientos (agrupar, no
    -- subconsultas por lote: con ~100 lotes y miles de ventas era la mitad del
    -- tiempo).
    agg AS (
        SELECT m.pid, m.k,
               max(m.vence) AS vence,
               sum(m.u) FILTER (WHERE m.fecha < v_ini) AS u_antes,
               sum(m.u) FILTER (WHERE m.fecha < v_ini) <> 0 AS saldo_antes,
               coalesce(sum(m.u) FILTER (WHERE m.fecha >= v_ini AND m.u > 0), 0) AS entradas,
               coalesce(-sum(m.u) FILTER (WHERE m.fecha >= v_ini AND m.u < 0), 0) AS salidas,
               bool_or(m.fecha >= v_ini) AS en_el_mes,
               bool_or(m.tipo = 'recibido_sin_lote') AS hay_sin_lote,
               coalesce(bool_or(m.aproximado) FILTER (WHERE m.fecha >= v_ini), false) AS aproximado,
               json_agg(json_build_object(
                    'fecha', m.fecha, 'tipo', m.tipo, 'documento', m.documento,
                    'detalle', m.detalle, 'unidades', m.u, 'aproximado', m.aproximado,
                    'responsable', coalesce(pe.nombre, ve.nombre))
                  ORDER BY m.fecha, m.u DESC) FILTER (WHERE m.fecha >= v_ini) AS movimientos
          FROM mov_k m
          LEFT JOIN LATERAL (SELECT public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name) AS nombre
                               FROM public.employees e WHERE e.id = m.quien) pe ON m.quien IS NOT NULL
          LEFT JOIN LATERAL (SELECT public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name) AS nombre
                               FROM public.employees e WHERE e.code = m.cod_vendedor
                              ORDER BY e.id LIMIT 1) ve ON m.cod_vendedor IS NOT NULL
         GROUP BY m.pid, m.k
    ),
    lotes AS (
        SELECT coalesce(a.pid, f.pid, e.pid) AS pid, coalesce(a.k, f.k, e.k) AS k,
               coalesce(a.vence, e.vence, f.vence) AS vence,
               (coalesce(a.k, f.k, e.k) = 'SIN LOTE' AND coalesce(a.hay_sin_lote, false)) AS solo_traslados,
               CASE WHEN v_foto_ini THEN 'foto'
                    WHEN n.nacio >= c_historia THEN 'historial'
                    ELSE 'sin_base' END AS inicial_origen,
               f.u AS u_foto, a.u_antes,
               coalesce(a.entradas, 0) AS entradas, coalesce(a.salidas, 0) AS salidas,
               e.u AS u_existe, e.u_vencidos,
               coalesce(a.aproximado, false) AS aproximado,
               coalesce(a.movimientos, '[]'::json) AS movimientos
          FROM agg a
          FULL JOIN foto_ini f ON f.pid = a.pid AND f.k = a.k
          FULL JOIN existe e ON e.pid = coalesce(a.pid, f.pid) AND e.k = coalesce(a.k, f.k)
          LEFT JOIN nacimiento n ON n.pid = coalesce(a.pid, f.pid, e.pid) AND n.k = coalesce(a.k, f.k, e.k)
         WHERE coalesce(a.en_el_mes, false)
            OR coalesce(f.u, 0) <> 0
            OR coalesce(e.u, 0) <> 0
            -- Un lote con historia entera que traía saldo al empezar el mes.
            OR (NOT v_foto_ini AND n.nacio >= c_historia AND coalesce(a.saldo_antes, false))
    ),
    lotes_f AS (
        SELECT l.*, x.inicial, x.existencia,
               x.inicial + l.entradas - l.salidas AS final_calculado,
               CASE WHEN l.solo_traslados OR x.inicial IS NULL OR x.existencia IS NULL THEN NULL
                    ELSE x.existencia - (x.inicial + l.entradas - l.salidas) END AS diferencia
          FROM lotes l
          CROSS JOIN LATERAL (SELECT
               CASE l.inicial_origen WHEN 'foto' THEN coalesce(l.u_foto, 0)
                                     WHEN 'historial' THEN coalesce(l.u_antes, 0) END AS inicial,
               CASE WHEN v_existencia IS NULL THEN NULL ELSE coalesce(l.u_existe, 0) END AS existencia) x
    ),
    -- El producto entero contra la foto diaria de `inventory_daily`: un cuadre
    -- INDEPENDIENTE del lote (no depende de que los lotes estén bien escritos).
    -- Esa foto no cuenta lo pasado a vencidos, así que se compara sin ellos.
    d_ini AS (
        SELECT d.erp_product_id AS pid, sum(d.unidades) AS u FROM public.inventory_daily d
         WHERE d.fecha = v_ini - 1 AND d.erp_sucursal_id = ANY(v_erp) AND d.erp_product_id = ANY(v_ids) GROUP BY 1
    ),
    d_fin AS (
        SELECT i.erp_product_id AS pid,
               sum(i.cantidad * coalesce((regexp_match(i.detalle, '\d+[xX](\d+)'))[1]::int, 1)) AS u
          FROM public.inventory i
         WHERE v_existencia = 'ahora' AND NOT i.is_vencidos
           AND i.erp_sucursal_id = ANY(v_erp) AND i.erp_product_id = ANY(v_ids) GROUP BY 1
        UNION ALL
        SELECT d.erp_product_id, sum(d.unidades) FROM public.inventory_daily d
         WHERE v_existencia IS DISTINCT FROM 'ahora' AND d.fecha = v_fin
           AND d.erp_sucursal_id = ANY(v_erp) AND d.erp_product_id = ANY(v_ids) GROUP BY 1
    ),
    neto AS (
        SELECT m.pid, sum(m.u) AS u FROM mov_k m WHERE m.fecha >= v_ini GROUP BY 1
    ),
    prod AS (
        SELECT p.id AS pid, p.nombre,
               coalesce(public.va_al_libro((SELECT dc.clase FROM public.dispensacion_clases dc WHERE dc.erp_product_id = p.id), p.es_antibiotico), false) AS en_el_libro,
               (SELECT max(f.factor) FROM public.mv_product_factor f WHERE f.product_id = p.id) AS factor_caja,
               coalesce(di.u, 0) AS d_ini, coalesce(df.u, 0) AS d_fin, coalesce(ne.u, 0) AS neto,
               coalesce(h.n, 0) AS fuera
          FROM public.products p
          LEFT JOIN d_ini di ON di.pid = p.id
          LEFT JOIN d_fin df ON df.pid = p.id
          LEFT JOIN neto ne ON ne.pid = p.id
          LEFT JOIN fuera_hint h ON h.pid = p.id
         WHERE p.id IN (SELECT DISTINCT pid FROM lotes_f)
    ),
    lotes_json AS (
        SELECT l.pid, json_agg(json_build_object(
                    'lote', l.k, 'vence', l.vence,
                    'generico', l.k = 'GENERICO', 'fundido', l.k LIKE '%\_%',
                    'sin_lote', l.solo_traslados, 'aproximado', l.aproximado,
                    'inicial', l.inicial, 'inicial_origen', l.inicial_origen,
                    'entradas', l.entradas, 'salidas', l.salidas,
                    'final_calculado', l.final_calculado,
                    'existencia', l.existencia, 'en_vencidos', coalesce(l.u_vencidos, 0),
                    'diferencia', l.diferencia, 'movimientos', l.movimientos)
                  ORDER BY l.solo_traslados, l.vence NULLS LAST, l.k) AS lotes
          FROM lotes_f l GROUP BY l.pid
    )
    SELECT json_build_object(
        'periodo', p_periodo, 'branch_id', p_branch_id, 'desde', v_ini, 'hasta', v_fin,
        'inicial_de', CASE WHEN v_foto_ini THEN 'foto' ELSE 'historial' END,
        'existencia_de', v_existencia,
        'historia_desde', c_historia,
        'resumen', (SELECT json_build_object(
                'productos', count(DISTINCT l.pid),
                'lotes', count(*) FILTER (WHERE NOT l.solo_traslados),
                'cuadran', count(*) FILTER (WHERE l.diferencia = 0),
                'con_diferencia', count(*) FILTER (WHERE l.diferencia <> 0),
                'sin_base', count(*) FILTER (WHERE l.diferencia IS NULL AND NOT l.solo_traslados),
                'genericos', count(*) FILTER (WHERE l.k = 'GENERICO'),
                'sin_lote_unidades', coalesce(sum(l.entradas) FILTER (WHERE l.solo_traslados), 0))
            FROM lotes_f l),
        'productos', (SELECT coalesce(json_agg(json_build_object(
                'product_id', p.pid, 'producto', p.nombre, 'en_el_libro', p.en_el_libro,
                'factor_caja', p.factor_caja,
                'traslados_fuera_del_portal', p.fuera,
                'cuadre', json_build_object(
                    'inicial', CASE WHEN v_hay_d_ini THEN p.d_ini END,
                    'neto', p.neto,
                    'existencia', CASE WHEN v_hay_d_fin THEN p.d_fin END,
                    'diferencia', CASE WHEN v_hay_d_ini AND v_hay_d_fin THEN p.d_fin - p.d_ini - p.neto END),
                'lotes', lj.lotes)
                ORDER BY p.nombre), '[]'::json)
            FROM prod p JOIN lotes_json lj ON lj.pid = p.pid)
    ) INTO v_out;
    RETURN v_out;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.get_registro_antibioticos_lote(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_registro_antibioticos_lote(bigint, text) TO authenticated, service_role;

-- La foto por lote, cada noche a la 01:50 SV (07:50 UTC): cinco minutos después
-- de `inventory_daily_snapshot`, sobre la misma existencia ya cerrada.
SELECT cron.schedule('antibioticos-lote-foto-diaria', '50 7 * * *',
                     $$SELECT public.antibioticos_lote_foto();$$);
