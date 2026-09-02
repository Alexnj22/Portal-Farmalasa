SET lock_timeout = '5s';

/* El historial de abonos mostraba el NOMBRE de quien cobró pero no su id, así
 * que la pantalla no podía pintar su cara — el avatar del portal resuelve la
 * ficha por id contra el store, y con un nombre suelto no tiene de dónde. */
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
                       ab.comprobante_url, ab.pos_proveedor, ab.fecha_documento,
                       ab.pago_id,
                       ab.abonado_por, e.name AS cobrado_por
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
