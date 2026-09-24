SET lock_timeout = '5s';

-- ─── Créditos que el origen BORRÓ ─────────────────────────────────────────
-- El sistema de la caja no anula un crédito: lo borra (el usuario lo hace
-- cuando la venta fue un error). El espejo sólo insertaba y actualizaba, así
-- que el crédito borrado quedaba en el portal con su saldo PARA SIEMPRE —
-- medido el 2026-09-24: 4 créditos, $79.96 de deuda que ya no existía, uno de
-- ellos (MAPFRE, $10.46) ya pasado del plazo y candidato al aviso de cobro.
--
-- No se borra la fila: se marca ANULADO con saldo 0 y la fecha en que se vio
-- desaparecer. Todo lo que cobra o avisa filtra por `saldo > 0.004`, así que
-- sale de la cartera sin tocar a ningún lector, y el rastro queda.

ALTER TABLE public.creditos_de_clientes ADD COLUMN IF NOT EXISTS anulado_el date;

COMMENT ON COLUMN public.creditos_de_clientes.anulado_el IS
  'Día en que el barrido completo dejó de ver el crédito en el origen (lo borraron). Con esto, estado=ANULADO y saldo=0. Si reaparece, sync_creditos_batch lo vuelve a NULL.';

CREATE OR REPLACE FUNCTION public.anular_creditos_ausentes(
    p_branch_id bigint, p_vistos text[], p_desde date, p_hasta date)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, extensions
AS $function$
DECLARE
    v_vivos     integer;
    v_ausentes  integer;
    v_n         integer;
BEGIN
    SELECT count(*) FILTER (WHERE NOT (credito_erp = ANY (p_vistos))), count(*)
      INTO v_ausentes, v_vivos
      FROM public.creditos_de_clientes
     WHERE branch_id = p_branch_id
       AND fecha BETWEEN p_desde AND p_hasta
       AND estado IS DISTINCT FROM 'ANULADO';

    /* Freno: el origen borra de a uno, a mano. Si de golpe «faltan» muchos,
     * lo que falló es la LECTURA (una página cortada, una sesión en otra
     * sala), no la cartera — y anular a partir de eso le borraría la deuda a
     * clientes que sí deben. Se lanza para que la corrida salga en rojo. */
    IF v_ausentes > greatest(10, v_vivos / 20) THEN
        RAISE EXCEPTION 'sala %: faltan % de % créditos en el origen — no se anula nada (¿lectura incompleta?)',
            p_branch_id, v_ausentes, v_vivos;
    END IF;

    UPDATE public.creditos_de_clientes
       SET estado = 'ANULADO', saldo = 0, anulado_el = current_date, updated_at = now()
     WHERE branch_id = p_branch_id
       AND fecha BETWEEN p_desde AND p_hasta
       AND estado IS DISTINCT FROM 'ANULADO'
       AND NOT (credito_erp = ANY (p_vistos));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.anular_creditos_ausentes(bigint, text[], date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anular_creditos_ausentes(bigint, text[], date, date) TO service_role;

-- Si un crédito ANULADO vuelve a aparecer en el origen, el upsert ya le trae
-- estado y saldo reales (el WHERE lo deja pasar porque 'ANULADO' difiere);
-- lo único que falta es quitarle la marca.
CREATE OR REPLACE FUNCTION public.sync_creditos_batch(p_filas jsonb)
 RETURNS TABLE(procesadas integer, cambiadas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
            -- Si el origen lo vuelve a mostrar, deja de estar anulado.
            anulado_el    = NULL,
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
$function$;
