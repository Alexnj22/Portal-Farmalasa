SET lock_timeout = '5s';

-- HB2 · La retención mira el MISMO universo que los libros: `anulada` = NOT
-- venta_valida(estado), y la fila entra si es venta fiscal (válida y con sello)
-- o si no es válida (se lista tachada). Antes sumaba documentos sin sello que
-- ningún libro cuenta (factura 6718317: $1.01 en octubre) y estados
-- desconocidos que la regla U2 manda no contar. Definición viva 2026-10-23.
CREATE OR REPLACE FUNCTION public.get_retencion_ventas(p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(branch_id bigint, fecha date, cliente text, nrc text, nit text, tipo_documento text, correlativo text, numero_control text, codigo_generacion uuid, sello_recepcion text, erp_invoice_id text, monto_sujeto numeric, retencion_iva numeric, total numeric, anulada boolean, json_path text, pdf_path text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT si.branch_id, si.fecha, si.cliente,
           nullif(btrim(coalesce(c.nrc, '')), ''),
           nullif(btrim(coalesce(c.nit, '')), ''),
           si.tipo_documento, si.correlativo, si.numero_control,
           si.codigo_generacion, si.recibido_mh, si.erp_invoice_id,
           coalesce(si.subtotal, 0), coalesce(si.retencion, 0), coalesce(si.total, 0),
           NOT coalesce(public.venta_valida(si.estado), false),
           d.json_path, d.pdf_path
    FROM public.sales_invoices si
    LEFT JOIN public.customers c ON c.id = si.customer_id
    LEFT JOIN public.sales_dte_documents d ON d.invoice_id = si.id
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND coalesce(si.retencion, 0) > 0
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND (coalesce(public.venta_fiscal(si.estado, si.recibido_mh), false)
           OR NOT coalesce(public.venta_valida(si.estado), false))
    ORDER BY si.branch_id, si.fecha,
             nullif(regexp_replace(si.erp_invoice_id, '\D', '', 'g'), '')::bigint;
$function$;

-- HB3 · «Vencido» con el día de El Salvador: `current_date` cambia de día a las
-- 18:00 SV y lo que vence hoy figuraba vencido seis horas antes. Definición viva.
CREATE OR REPLACE FUNCTION public.get_cuentas_por_pagar(p_desde date DEFAULT NULL::date)
 RETURNS TABLE(emisor_nit text, proveedor text, proveedor_id bigint, dias_credito integer, limite_credito numeric, forma_pago text, documentos integer, deuda numeric, aplicado numeric, saldo numeric, en_tramite numeric, vencido numeric, documentos_vencidos integer, disponible numeric, proximo_vence date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH permitido AS (
    SELECT (SELECT auth_has_module_permission('cuentas_por_pagar','can_view')) AS ok,
           (now() AT TIME ZONE 'America/El_Salvador')::date AS hoy
  ), doc AS (
    SELECT * FROM public.compra_deuda_documentos
     WHERE p_desde IS NULL OR fecha_emision >= p_desde
  )
  SELECT d.emisor_nit,
         coalesce(max(m.nombre), max(d.emisor_nombre)),
         max(m.id),
         max(m.dias_credito),
         max(m.limite_credito),
         max(m.forma_pago),
         count(*)::integer,
         round(sum(d.monto), 2),
         round(sum(d.aplicado), 2),
         round(sum(d.monto - d.aplicado), 2),
         round(sum(d.en_tramite), 2),
         round(coalesce(sum(d.monto - d.aplicado) FILTER (
                 WHERE d.vence IS NOT NULL AND d.vence < pe.hoy
                   AND d.monto - d.aplicado > 0), 0), 2),
         coalesce(count(*) FILTER (
                 WHERE d.vence IS NOT NULL AND d.vence < pe.hoy
                   AND d.monto - d.aplicado > 0), 0)::integer,
         CASE WHEN max(m.limite_credito) IS NOT NULL
              THEN round(max(m.limite_credito) - sum(d.monto - d.aplicado), 2) END,
         min(d.vence) FILTER (WHERE d.monto - d.aplicado > 0)
    FROM doc d, permitido pe
    LEFT JOIN LATERAL (SELECT x.* FROM public.proveedores_maestro x
                        WHERE x.nit = d.emisor_nit ORDER BY x.id LIMIT 1) m ON true
   WHERE pe.ok
   GROUP BY d.emisor_nit
  HAVING round(sum(d.monto - d.aplicado), 2) <> 0
   ORDER BY 10 DESC;
$function$;
