SET lock_timeout = '5s';

-- Bodega escribe a mano el código de generación y a veces se come un carácter
-- o mete un espacio («21879FD-923F-E0FA-A1», «5507E80D- E317-383C-»): ninguna
-- de las tres igualdades lo reconoce. Los primeros 12 caracteres de un código
-- de generación (UUID) no se repiten entre documentos, así que coincidir en
-- ellos basta. Medido el 2026-10-30: 6 de las 96 facturas de 16-30 días.
-- Igualdad sobre `left(...,12)`: sigue siendo hasheable.
CREATE OR REPLACE FUNCTION public.get_documentos_sin_cargar(p_dias integer DEFAULT 30)
 RETURNS TABLE(document_id bigint, fecha_emision date, emisor_nombre text, emisor_nit text, codigo_generacion text, numero_control text, monto_total numeric, renglones integer, tiene_pdf boolean, proveedor_ficha text, dias_desde integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH recibos AS MATERIALIZED (
    -- La normalización del número se paga UNA vez por recibo, no una vez por
    -- par documento×recibo. Es la mitad del arreglo.
    SELECT pr.sello_recibido,
           upper(replace(replace(replace(btrim(pr.documento_numero),' ',''),'.',''),'O','0')) AS num
      FROM public.purchase_receipts pr
     WHERE coalesce(pr.estado,'') <> 'anulada'
  ), prefijos AS MATERIALIZED (
    SELECT DISTINCT left(num, 12) AS p FROM recibos WHERE length(num) >= 12 AND num LIKE '%-%'
  )
  SELECT d.id, d.fecha_emision, d.emisor_nombre, d.emisor_nit,
         d.codigo_generacion::text, d.numero_control, d.monto_total,
         coalesce(array_length(string_to_array(d.items_text, ' | '), 1), 0)::integer,
         d.pdf_path IS NOT NULL,
         (SELECT m.nombre FROM public.proveedores_maestro m
           WHERE m.nit = d.emisor_nit ORDER BY m.id LIMIT 1),
         (current_date - d.fecha_emision)::integer
    FROM public.purchase_dte_documents d
   WHERE NOT d.invalidado
     AND d.tipo_dte IN ('01','03')
     AND d.json_path IS NOT NULL
     AND d.fecha_emision >= current_date - coalesce(p_dias, 30)
     AND (SELECT auth_has_module_permission('compras','can_view')
           OR auth_has_module_permission('facturas_compra','can_view'))
     -- Las cuatro ramas del OR original, una por NOT EXISTS. Cada una es una
     -- igualdad simple, o sea hasheable.
     AND NOT EXISTS (SELECT 1 FROM recibos r
                      WHERE d.sello_recibido IS NOT NULL AND r.sello_recibido = d.sello_recibido)
     AND NOT EXISTS (SELECT 1 FROM recibos r
                      WHERE r.num = left(upper(d.codigo_generacion::text), 20))
     AND NOT EXISTS (SELECT 1 FROM recibos r
                      WHERE r.num = left(replace(upper(d.codigo_generacion::text), '-', ''), 20))
     AND NOT EXISTS (SELECT 1 FROM recibos r
                      WHERE r.num = upper(d.codigo_generacion::text))
     AND NOT EXISTS (SELECT 1 FROM prefijos x
                      WHERE x.p = left(upper(d.codigo_generacion::text), 12))
     -- Lo que una persona ya resolvió (2026-10-30): este documento, o todo lo
     -- de este proveedor.
     AND NOT EXISTS (SELECT 1 FROM public.compra_documento_resuelto x WHERE x.document_id = d.id)
     AND NOT EXISTS (SELECT 1 FROM public.compra_proveedor_no_va_a_bodega x WHERE x.nit = d.emisor_nit)
   ORDER BY d.fecha_emision DESC, d.id DESC;
$function$;
