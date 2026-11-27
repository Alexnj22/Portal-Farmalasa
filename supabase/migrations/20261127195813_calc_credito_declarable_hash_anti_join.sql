-- Cierre de período: calc_credito_declarable de ~600 ms a ~14 ms por mes.
-- El NOT EXISTS con c.doc IN (3 expresiones) caía en Nested Loop Anti Join;
-- partido en tres igualdades → Hash Anti Join. Mismo resultado al centavo (ene–nov 2026).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.calc_credito_declarable(p_desde date, p_hasta date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH compras_norm AS (
    SELECT pr.id, pr.total, pr.fecha, pr.sello_recibido,
           upper(replace(replace(replace(btrim(pr.documento_numero), ' ', ''), '.', ''), 'O', '0')) AS doc
      FROM public.purchase_receipts pr
     WHERE (length(btrim(coalesce(pr.documento_numero, ''))) >= 8 OR pr.sello_recibido IS NOT NULL)
       AND pr.fecha BETWEEN p_desde - 5 AND p_hasta + 5
  ),
  tipos AS (
    SELECT * FROM (VALUES ('03',1,true), ('05',-1,true), ('06',1,true),
                          ('01',1,false), ('09',1,false), ('07',1,false)
    ) AS t(tipo_dte, signo, da_credito)
  ),
  del_erp AS (
    SELECT coalesce(pr.iva,0) AS iva, 1 AS signo, true AS da_credito,
           pm.clasificacion_estado, pm.iva_deducible
      FROM public.purchase_receipts pr
      LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
     WHERE pr.fecha BETWEEN p_desde AND p_hasta
       AND coalesce(pr.estado,'') <> 'anulada'
  ),
  solo_doc AS (
    SELECT coalesce(d.total_iva,0) AS iva, t.signo, t.da_credito,
           pm.clasificacion_estado, pm.iva_deducible
      FROM public.purchase_dte_documents d
      JOIN tipos t ON t.tipo_dte = d.tipo_dte
      LEFT JOIN public.proveedores_maestro pm ON pm.id = d.proveedor_id
     WHERE coalesce(d.invalidado,false) = false
       AND d.fecha_emision BETWEEN p_desde AND p_hasta
       AND NOT EXISTS (SELECT 1 FROM compras_norm c
                        WHERE d.sello_recibido IS NOT NULL AND c.sello_recibido = d.sello_recibido)
       -- Antes: c.doc IN (las tres formas). Partido en tres igualdades para
       -- que cada una sea un Hash Anti Join (567 ms → 14 ms por mes).
       AND NOT EXISTS (SELECT 1 FROM compras_norm c
                        WHERE c.doc = left(upper(d.codigo_generacion::text),20))
       AND NOT EXISTS (SELECT 1 FROM compras_norm c
                        WHERE c.doc = left(replace(upper(d.codigo_generacion::text),'-',''),20))
       AND NOT EXISTS (SELECT 1 FROM compras_norm c
                        WHERE c.doc = upper(d.codigo_generacion::text))
       AND NOT EXISTS (SELECT 1 FROM public.purchase_receipts pr
                         JOIN public.proveedores_maestro pm2 ON pm2.supplier_id = pr.supplier_id
                        WHERE pm2.nit = d.emisor_nit
                          AND abs(pr.total - coalesce(d.monto_total,0)) < 0.01
                          AND pr.fecha BETWEEN d.fecha_emision - 3 AND d.fecha_emision + 3)
  )
  SELECT round(coalesce(sum(
           CASE WHEN da_credito
                     AND clasificacion_estado = 'confirmada'
                     AND iva_deducible IS TRUE
                THEN iva * signo ELSE 0 END), 0), 2)
    FROM (SELECT * FROM del_erp UNION ALL SELECT * FROM solo_doc) t;
$function$;
