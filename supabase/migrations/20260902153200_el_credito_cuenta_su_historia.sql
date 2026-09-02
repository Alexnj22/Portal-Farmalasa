SET lock_timeout = '5s';

/* ── Un crédito tiene que contar su historia ───────────────────────────────
 *
 * Pedido del usuario (2-sep): «necesito que tenga fecha de compra, y fecha de
 * último abono … además necesito ver quién le vendió y el historial de abonos.
 * Y al tocar la card que muestre toda la información, incluido la compra».
 */

/* La fecha del último abono. Va como COLUMNA y no como una consulta al vuelo
 * porque se muestra en la lista: derivarla ahí sería una subconsulta por fila
 * sobre 124 tarjetas.
 *
 * ⚠️ Sólo conoce los abonos hechos DESDE EL PORTAL, y el usuario ya lo sabe
 * («esto lo tendremos cuando empecemos a abonar desde aquí»). El sistema de la
 * caja no expone la fecha de sus abonos: da el acumulado, no el detalle. Un
 * NULL acá significa «no se le ha abonado desde el portal», nunca «no se le ha
 * abonado» — y por eso la pantalla lo dice con esas palabras y no con un guion. */
ALTER TABLE public.creditos_de_clientes
    ADD COLUMN IF NOT EXISTS ultimo_abono_el date;

COMMENT ON COLUMN public.creditos_de_clientes.ultimo_abono_el IS
    'Fecha del último abono hecho DESDE EL PORTAL. NULL no significa que no se le haya abonado: el sistema de origen no expone la fecha de los suyos.';

/* Backfill de lo que ya se cobró por acá. Hoy son cero filas —no se ha hecho
 * ningún abono todavía— pero la migración tiene que ser correcta el día que se
 * reproduzca sobre una base con historia. */
UPDATE public.creditos_de_clientes c
SET ultimo_abono_el = a.ultimo
FROM (
    SELECT branch_id, credito_erp, max((created_at AT TIME ZONE 'America/El_Salvador')::date) AS ultimo
    FROM public.creditos_abonos_portal
    WHERE anulado_at IS NULL
    GROUP BY branch_id, credito_erp
) a
WHERE a.branch_id = c.branch_id AND a.credito_erp = c.credito_erp
  AND c.ultimo_abono_el IS DISTINCT FROM a.ultimo;


/* ── Todo lo de UN crédito, en una sola llamada ────────────────────────────
 *
 * `RETURNS json` y no `SETOF`: son tres listas de forma distinta —la ficha, los
 * renglones de la compra y los abonos— y devolverlas por separado serían tres
 * viajes para pintar un panel. Además el techo de las 1000 filas no aplica.
 *
 * INVOKER: quien lo llama tiene que poder ver el crédito por su propio RLS. Un
 * DEFINER acá dejaría leer la compra de una sala ajena sabiendo un id.
 *
 * La compra sale de `sales_invoice_items` del portal y no del sistema de
 * origen: verificado el 2-sep, **los 124 créditos con saldo tienen sus 238
 * renglones acá**, así que no hace falta salir a la red para pintarlos.
 */
CREATE OR REPLACE FUNCTION public.credito_detalle(p_id bigint)
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
    SELECT json_build_object(
        'credito', to_json(x),
        'compra', COALESCE((
            SELECT json_agg(to_json(r) ORDER BY r.linea_num, r.id)
            FROM (
                SELECT it.id, it.linea_num, it.descripcion, it.cantidad, it.presentacion,
                       it.precio_unitario, it.total_linea, it.lote, it.fecha_vencimiento
                FROM public.sales_invoice_items it
                JOIN public.sales_invoices si ON si.id = it.invoice_id
                WHERE si.erp_invoice_id = x.factura_erp
            ) r
        ), '[]'::json),
        'abonos', COALESCE((
            SELECT json_agg(to_json(b) ORDER BY b.created_at DESC)
            FROM (
                SELECT ab.id, ab.monto, ab.forma, ab.documento, ab.created_at,
                       ab.saldo_antes, ab.saldo_despues, ab.anulado_at,
                       e.name AS cobrado_por
                FROM public.creditos_abonos_portal ab
                LEFT JOIN public.employees e ON e.id = ab.abonado_por
                WHERE ab.branch_id = x.branch_id AND ab.credito_erp = x.credito
            ) b
        ), '[]'::json)
    )
    FROM (
        SELECT c.id, c.branch_id, b.name AS sala,
               c.credito_erp AS credito, c.factura_erp, c.numero_doc AS documento,
               c.tipo_doc, c.fecha, c.cliente, c.total, c.abonado, c.saldo, c.estado,
               c.customer_id, c.vendedor_id, v.name AS vendedor,
               c.vencio_el, c.pagado_el, c.ultimo_abono_el,
               (current_date - c.fecha)::integer AS dias
        FROM public.creditos_de_clientes c
        JOIN public.branches b ON b.id = c.branch_id
        LEFT JOIN public.employees v ON v.id = c.vendedor_id
        WHERE c.id = p_id
    ) x;
$$;

REVOKE EXECUTE ON FUNCTION public.credito_detalle(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.credito_detalle(bigint) TO authenticated, service_role;
