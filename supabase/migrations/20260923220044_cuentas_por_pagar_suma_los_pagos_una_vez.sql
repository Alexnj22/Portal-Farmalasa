-- Cuentas por pagar: los pagos se suman UNA vez, no dos veces por factura.
--
-- `compra_deuda_documentos` calculaba `aplicado` y `en_tramite` con dos
-- subconsultas correlacionadas por documento: 2,252 facturas × 2 búsquedas en
-- `compra_pagos`. Con la tabla de pagos VACÍA ya costaba 9,008 bloques; cada
-- pago nuevo lo hacía crecer. `gate:perf` sección F la marcó en
-- `get_cuentas_por_pagar`: 237 MB por llamada sin declarar.
--
-- Ahora es un LEFT JOIN contra los pagos agregados por documento, con FILTER
-- por estado. Mismas columnas, mismos tipos, mismo orden (CREATE OR REPLACE lo
-- exige) y `security_invoker` se conserva.
--
-- Medido como QA antes/después en una transacción deshecha: resumen (todo y
-- desde 2026), y el detalle del proveedor con más documentos, con md5
-- idéntico. Resumen 38 → 14 ms; lectura de la vista 11,526 → 648 bloques.

SET lock_timeout = '5s';

CREATE OR REPLACE VIEW public.compra_deuda_documentos WITH (security_invoker = true) AS
 SELECT d.id AS document_id, d.emisor_nit, d.emisor_nombre, d.fecha_emision, d.tipo_dte, d.codigo_generacion, d.numero_control,
        ((CASE WHEN d.tipo_dte = '05'::text THEN '-1'::integer ELSE 1 END)::numeric * COALESCE(d.monto_total, 0::numeric)) AS monto,
        pm.dias_credito,
        CASE WHEN pm.dias_credito IS NOT NULL THEN d.fecha_emision + pm.dias_credito ELSE NULL::date END AS vence,
        COALESCE(pg.aplicado, 0::numeric) AS aplicado,
        COALESCE(pg.en_tramite, 0::numeric) AS en_tramite
   FROM public.purchase_dte_documents d
   LEFT JOIN LATERAL (SELECT m.dias_credito FROM public.proveedores_maestro m WHERE m.nit = d.emisor_nit ORDER BY m.id LIMIT 1) pm ON true
   LEFT JOIN (SELECT a.document_id,
                     sum(a.monto) FILTER (WHERE p.estado = 'aprobado'::text)  AS aplicado,
                     sum(a.monto) FILTER (WHERE p.estado = 'pendiente'::text) AS en_tramite
                FROM public.compra_pago_aplicado a JOIN public.compra_pagos p ON p.id = a.pago_id
               GROUP BY a.document_id) pg ON pg.document_id = d.id
  WHERE NOT d.invalidado AND d.tipo_dte = ANY (ARRAY['01'::text, '03'::text, '05'::text, '06'::text]) AND d.monto_total IS NOT NULL;
