-- ============================================================
-- Pedidos — RPCs de métricas y vista en curso
-- v2.2.161
-- ============================================================

-- ── get_pedidos_en_curso ──────────────────────────────────────
-- Retorna una fila por (pedido × sucursal) para todos los pedidos
-- activos (confirmado / enviado). El frontend agrupa por pedido_id.

CREATE OR REPLACE FUNCTION get_pedidos_en_curso()
RETURNS TABLE (
    pedido_id           uuid,
    numero              integer,
    created_at          timestamptz,
    pedido_status       text,
    notes               text,
    enviado_at          timestamptz,
    erp_sucursal_id     integer,
    iniciado_at         timestamptz,
    finalizado_at       timestamptz,
    recibido_erp_at     timestamptz,
    llegada_fisica_at   timestamptz,
    pausado_at          timestamptz,
    reanudado_at        timestamptz,
    pausa_razon         text,
    num_pausas          integer,
    min_pausado_total   integer
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    WITH suc_list AS (
        SELECT DISTINCT pi.pedido_id, pi.erp_sucursal_id
        FROM pedido_items pi
        WHERE pi.pedido_id IN (
            SELECT id FROM pedidos WHERE status IN ('confirmado', 'enviado')
        )
    ),
    pause_agg AS (
        SELECT
            pph.pedido_id,
            pph.erp_sucursal_id,
            COUNT(*)::integer  AS num_pausas,
            SUM(
                EXTRACT(EPOCH FROM (
                    COALESCE(pph.reanudado_at, NOW()) - pph.pausado_at
                ))::integer / 60
            )::integer         AS min_total
        FROM pedido_pausa_historial pph
        GROUP BY pph.pedido_id, pph.erp_sucursal_id
    )
    SELECT
        p.id              AS pedido_id,
        p.numero,
        p.created_at,
        p.status          AS pedido_status,
        p.notes,
        p.enviado_at,
        sl.erp_sucursal_id,
        pss.iniciado_at,
        pss.finalizado_at,
        pss.recibido_erp_at,
        pss.llegada_fisica_at,
        pss.pausado_at,
        pss.reanudado_at,
        pss.pausa_razon,
        COALESCE(pa.num_pausas, 0)  AS num_pausas,
        COALESCE(pa.min_total,  0)  AS min_pausado_total
    FROM pedidos p
    JOIN suc_list sl ON sl.pedido_id = p.id
    LEFT JOIN pedido_sucursal_status pss
        ON pss.pedido_id = p.id AND pss.erp_sucursal_id = sl.erp_sucursal_id
    LEFT JOIN pause_agg pa
        ON pa.pedido_id = p.id AND pa.erp_sucursal_id = sl.erp_sucursal_id
    WHERE p.status IN ('confirmado', 'enviado')
    ORDER BY p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_pedidos_en_curso() TO authenticated;


-- ── get_pedido_kpis ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_pedido_kpis(
    p_desde date DEFAULT CURRENT_DATE - 30,
    p_hasta date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    pedido_id              uuid,
    numero                 integer,
    erp_sucursal_id        integer,
    created_at             timestamptz,
    tiempo_prep_neto_min   integer,
    tiempo_pausado_min     integer,
    tiempo_transito_min    integer,
    tiempo_recuento_min    integer,
    num_pausas             integer
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    WITH pause_totals AS (
        SELECT
            pph.pedido_id,
            pph.erp_sucursal_id,
            COUNT(*)::integer AS num_pausas,
            SUM(
                EXTRACT(EPOCH FROM (
                    COALESCE(pph.reanudado_at, NOW()) - pph.pausado_at
                ))::integer / 60
            )::integer        AS total_pausa_min
        FROM pedido_pausa_historial pph
        GROUP BY pph.pedido_id, pph.erp_sucursal_id
    ),
    primera_firma AS (
        SELECT pedido_id, erp_sucursal_id, MIN(created_at) AS primera_firma_at
        FROM pedido_recepcion_firmas
        GROUP BY pedido_id, erp_sucursal_id
    )
    SELECT
        p.id,
        p.numero,
        pss.erp_sucursal_id,
        p.created_at,
        -- Prep neto: (finalizado - iniciado) menos tiempo pausado
        CASE
            WHEN pss.iniciado_at IS NOT NULL AND pss.finalizado_at IS NOT NULL THEN
                GREATEST(0,
                    EXTRACT(EPOCH FROM (pss.finalizado_at - pss.iniciado_at))::integer / 60
                    - COALESCE(pt.total_pausa_min, 0)
                )
        END::integer                                             AS tiempo_prep_neto_min,
        COALESCE(pt.total_pausa_min, 0)::integer                AS tiempo_pausado_min,
        -- Tránsito: finalizado → primera firma de recepción
        CASE
            WHEN pss.finalizado_at IS NOT NULL AND pf.primera_firma_at IS NOT NULL THEN
                GREATEST(0,
                    EXTRACT(EPOCH FROM (pf.primera_firma_at - pss.finalizado_at))::integer / 60
                )
        END::integer                                             AS tiempo_transito_min,
        -- Recuento: primera firma → recibido_erp
        CASE
            WHEN pf.primera_firma_at IS NOT NULL AND pss.recibido_erp_at IS NOT NULL THEN
                GREATEST(0,
                    EXTRACT(EPOCH FROM (pss.recibido_erp_at - pf.primera_firma_at))::integer / 60
                )
        END::integer                                             AS tiempo_recuento_min,
        COALESCE(pt.num_pausas, 0)                               AS num_pausas
    FROM pedidos p
    JOIN pedido_sucursal_status pss ON pss.pedido_id = p.id
    LEFT JOIN pause_totals pt
        ON pt.pedido_id = p.id AND pt.erp_sucursal_id = pss.erp_sucursal_id
    LEFT JOIN primera_firma pf
        ON pf.pedido_id = p.id AND pf.erp_sucursal_id = pss.erp_sucursal_id
    WHERE p.created_at::date BETWEEN p_desde AND p_hasta
      AND p.status NOT IN ('anulado', 'confirmado')
    ORDER BY p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_pedido_kpis(date, date) TO authenticated;


-- ── get_pausa_razones_stats ───────────────────────────────────

CREATE OR REPLACE FUNCTION get_pausa_razones_stats(
    p_desde date DEFAULT CURRENT_DATE - 30,
    p_hasta date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    razon        text,
    conteo       integer,
    min_promedio integer
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT
        COALESCE(pph.razon, 'Sin razón')  AS razon,
        COUNT(*)::integer                  AS conteo,
        AVG(
            EXTRACT(EPOCH FROM (
                COALESCE(pph.reanudado_at, NOW()) - pph.pausado_at
            ))::integer / 60
        )::integer                         AS min_promedio
    FROM pedido_pausa_historial pph
    JOIN pedidos p ON p.id = pph.pedido_id
    WHERE p.created_at::date BETWEEN p_desde AND p_hasta
    GROUP BY COALESCE(pph.razon, 'Sin razón')
    ORDER BY COUNT(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION get_pausa_razones_stats(date, date) TO authenticated;
