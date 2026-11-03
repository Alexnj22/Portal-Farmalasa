SET lock_timeout = '5s';
-- «Comprobado» comparaba la cantidad en PRESENTACIONES (10 cajas) y el costo
-- por caja (8.2491) contra la copia del sistema, que guarda UNIDADES (240) y
-- costo por unidad (0.3437). Sólo cuadraba cuando la presentación era de 1:
-- la compra 6484 (Viro-Grip, caja de 24) salió «Difiere» estando bien.
-- Ahora: unidades (o presentaciones, por si la lista viniera así) y el total
-- del renglón al centavo, que no depende de cómo se redondeó el costo unitario.
CREATE OR REPLACE FUNCTION public.get_compra_registro_json(p_desde date, p_hasta date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT ((SELECT public.auth_has_module_permission('cargar_compra', 'can_view'))
       OR (SELECT public.auth_has_module_permission('compras', 'can_view'))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT coalesce(json_agg(to_json(t) ORDER BY t.fecha_documento DESC, t.carga_id DESC, t.renglon), '[]'::json)
      FROM (
        SELECT g.*, e.name AS cargado_por_nombre,
               CASE WHEN g.tipo = 'consumo' OR g.erp_compra_id IS NULL THEN NULL
                    WHEN pr.id IS NULL THEN 'sin_copia'
                    WHEN EXISTS (SELECT 1 FROM public.purchase_receipt_items i
                                  WHERE i.receipt_id = pr.id AND i.erp_product_id = g.erp_product_id
                                    AND (abs(i.cantidad - g.unidades) < 0.001 OR abs(i.cantidad - g.cantidad) < 0.001)
                                    AND abs(i.total_linea - round(g.cantidad * g.costo, 2)) <= 0.02) THEN 'cuadra'
                    ELSE 'difiere' END AS en_sistema
          FROM public.compra_registro g
          LEFT JOIN public.employees e ON e.id = g.cargado_por
          LEFT JOIN LATERAL (SELECT pr.id FROM public.purchase_receipts pr
                              WHERE pr.erp_purchase_id = g.erp_compra_id AND pr.branch_id = 30 LIMIT 1) pr ON true
         WHERE g.fecha_documento BETWEEN p_desde AND p_hasta
      ) t
  );
END $function$;
