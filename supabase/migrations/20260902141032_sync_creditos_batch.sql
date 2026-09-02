SET lock_timeout = '5s';

/* ── El sync de los créditos: escribe SÓLO lo que cambió ───────────────────
 *
 * `INSERT ... ON CONFLICT DO UPDATE ... WHERE (cols) IS DISTINCT FROM
 * (EXCLUDED.cols)`, que es la regla del proyecto para todo cron. Un
 * `.upsert(todasLasFilas)` cada hora reescribiría **2,386 filas × 24 = 57,264
 * escrituras al día** para reflejar un puñado de abonos: churn de WAL,
 * autovacuum constante y presupuesto de disco quemado. Es exactamente lo que
 * `inventory` acumuló en 935 millones de updates sobre 24 mil filas.
 *
 * Devuelve cuántas ENTRARON de verdad, no cuántas se mandaron. Un sync que
 * informa «2,386 procesadas» cada hora no deja ver que hace un mes no cambia
 * nada porque el origen dejó de responder.
 *
 * ── Las dos fechas que se OBSERVAN y no se calculan ───────────────────────
 * `vencio_el` y `pagado_el` se escriben la primera vez que se ven, con
 * `COALESCE(viejo, nuevo)`: una fecha observada no se recalcula. Si se
 * derivaran de `fecha + 30` cada vez, el aviso no podría saber si ya avisó, y
 * un crédito que se paga y se vuelve a abrir perdería su historia.
 *
 * ── El amarre con la ficha y el vendedor ──────────────────────────────────
 * Sale de `sales_invoices` por `erp_invoice_id`, que es el único número que
 * los dos lados comparten. `LEFT JOIN` a propósito: un crédito cuya factura
 * todavía no sincronizó entra igual, sin ficha, y la toma en la corrida
 * siguiente. Perder el crédito por no tener el amarre sería perder la deuda.
 */
CREATE OR REPLACE FUNCTION public.sync_creditos_batch(p_filas jsonb)
RETURNS TABLE (procesadas integer, cambiadas integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_cambiadas integer;
    v_total     integer;
BEGIN
    SELECT count(*) INTO v_total FROM jsonb_array_elements(p_filas);

    WITH entrada AS (
        SELECT
            (e->>'branch_id')::bigint      AS branch_id,
            e->>'credito'                  AS credito_erp,
            nullif(e->>'factura_erp','')   AS factura_erp,
            nullif(e->>'documento','')     AS numero_doc,
            nullif(e->>'tipo_doc','')      AS tipo_doc,
            (e->>'fecha')::date            AS fecha,
            e->>'cliente'                  AS cliente,
            (e->>'total')::numeric         AS total,
            (e->>'abonado')::numeric       AS abonado,
            (e->>'saldo')::numeric         AS saldo,
            nullif(e->>'estado','')        AS estado
        FROM jsonb_array_elements(p_filas) e
    ),
    /* La factura del portal, UNA vez por crédito. `DISTINCT ON` porque un
     * `erp_invoice_id` repetido —que no debería, pero el sync de ventas es de
     * otra pieza— multiplicaría las filas del INSERT sin avisar. */
    conFactura AS (
        SELECT en.*, si.customer_id, si.cod_vendedor
        FROM entrada en
        LEFT JOIN LATERAL (
            SELECT s.customer_id, s.cod_vendedor
            FROM public.sales_invoices s
            WHERE s.erp_invoice_id = en.factura_erp
            LIMIT 1
        ) si ON en.factura_erp IS NOT NULL
    ),
    listo AS (
        SELECT cf.*, emp.id AS vendedor_id
        FROM conFactura cf
        LEFT JOIN public.employees emp ON emp.code = cf.cod_vendedor
    ),
    escrito AS (
        INSERT INTO public.creditos_de_clientes AS c (
            branch_id, credito_erp, factura_erp, numero_doc, tipo_doc, fecha,
            cliente, total, abonado, saldo, estado,
            customer_id, vendedor_code, vendedor_id,
            vencio_el, pagado_el, updated_at
        )
        SELECT
            l.branch_id, l.credito_erp, l.factura_erp, l.numero_doc, l.tipo_doc, l.fecha,
            l.cliente, l.total, l.abonado, l.saldo, l.estado,
            l.customer_id, l.cod_vendedor, l.vendedor_id,
            CASE WHEN l.saldo > 0.004 AND current_date > l.fecha + 30 THEN current_date END,
            CASE WHEN l.saldo <= 0.004 THEN current_date END,
            now()
        FROM listo l
        ON CONFLICT (branch_id, credito_erp) DO UPDATE SET
            factura_erp   = EXCLUDED.factura_erp,
            numero_doc    = EXCLUDED.numero_doc,
            tipo_doc      = EXCLUDED.tipo_doc,
            fecha         = EXCLUDED.fecha,
            cliente       = EXCLUDED.cliente,
            total         = EXCLUDED.total,
            abonado       = EXCLUDED.abonado,
            saldo         = EXCLUDED.saldo,
            estado        = EXCLUDED.estado,
            -- El amarre no se BORRA con un null: si la factura todavía no
            -- sincronizó, el crédito conserva la ficha que ya tenía.
            customer_id   = COALESCE(EXCLUDED.customer_id,   c.customer_id),
            vendedor_code = COALESCE(EXCLUDED.vendedor_code, c.vendedor_code),
            vendedor_id   = COALESCE(EXCLUDED.vendedor_id,   c.vendedor_id),
            -- Fechas OBSERVADAS: gana la primera vez que se vieron.
            vencio_el     = COALESCE(c.vencio_el, EXCLUDED.vencio_el),
            pagado_el     = CASE WHEN EXCLUDED.pagado_el IS NULL THEN NULL
                                 ELSE COALESCE(c.pagado_el, EXCLUDED.pagado_el) END,
            updated_at    = now()
        WHERE (c.factura_erp, c.numero_doc, c.tipo_doc, c.fecha, c.cliente,
               c.total, c.abonado, c.saldo, c.estado)
          IS DISTINCT FROM
              (EXCLUDED.factura_erp, EXCLUDED.numero_doc, EXCLUDED.tipo_doc,
               EXCLUDED.fecha, EXCLUDED.cliente, EXCLUDED.total,
               EXCLUDED.abonado, EXCLUDED.saldo, EXCLUDED.estado)
           OR (EXCLUDED.customer_id   IS NOT NULL AND c.customer_id   IS NULL)
           OR (EXCLUDED.vendedor_id   IS NOT NULL AND c.vendedor_id   IS NULL)
           OR (EXCLUDED.vencio_el     IS NOT NULL AND c.vencio_el     IS NULL)
        RETURNING 1
    )
    SELECT count(*)::integer INTO v_cambiadas FROM escrito;

    RETURN QUERY SELECT v_total, v_cambiadas;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_creditos_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_creditos_batch(jsonb) TO service_role;
