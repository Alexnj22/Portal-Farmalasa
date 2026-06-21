-- ============================================================
-- get_pedidos_en_curso v3
-- Agrega finalizado_por (pedido_sucursal_status) y
-- enviado_por (pedidos) para mostrar quién marcó Listo y En Ruta
-- ============================================================

DROP FUNCTION IF EXISTS get_pedidos_en_curso();

CREATE OR REPLACE FUNCTION get_pedidos_en_curso()
RETURNS TABLE (
    pedido_id         UUID,
    numero            INT,
    notes             TEXT,
    pedido_status     TEXT,
    created_at        TIMESTAMPTZ,
    enviado_at        TIMESTAMPTZ,
    erp_sucursal_id   INT,
    iniciado_at       TIMESTAMPTZ,
    finalizado_at     TIMESTAMPTZ,
    pausado_at        TIMESTAMPTZ,
    reanudado_at      TIMESTAMPTZ,
    llegada_fisica_at TIMESTAMPTZ,
    recibido_erp_at   TIMESTAMPTZ,
    min_pausado_total INT,
    created_by        UUID,
    iniciado_por      UUID,
    finalizado_por    UUID,
    enviado_por       UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        p.id                                   AS pedido_id,
        p.numero,
        p.notes,
        p.status                               AS pedido_status,
        p.created_at,
        p.enviado_at,
        pss.erp_sucursal_id,
        pss.iniciado_at,
        pss.finalizado_at,
        pss.pausado_at,
        pss.reanudado_at,
        pss.llegada_fisica_at,
        pss.recibido_erp_at,
        COALESCE(
            (SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(pph.reanudado_at, NOW()) - pph.pausado_at)) / 60)::INT
             FROM   pedido_pausa_historial pph
             WHERE  pph.pedido_id       = p.id
               AND  pph.erp_sucursal_id = pss.erp_sucursal_id),
            0
        )                                      AS min_pausado_total,
        p.created_by,
        pss.iniciado_por,
        pss.finalizado_por,
        p.enviado_por
    FROM   pedidos p
    JOIN   pedido_sucursal_status pss ON pss.pedido_id = p.id
    WHERE  p.status NOT IN ('completado', 'parcial', 'anulado')
    ORDER  BY p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_pedidos_en_curso() TO authenticated;
