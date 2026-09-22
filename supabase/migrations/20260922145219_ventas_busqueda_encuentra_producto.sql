-- A1 (segunda mitad) · La búsqueda de Ventas encuentra también el PRODUCTO.
--
-- El 21-sep alguien buscó en Ventas, durante cinco horas, EXFORGE HCT, CLOPERA,
-- PREDIAL PLUS, MODUSI, IMOT y METGLITAL LE. Esta función sólo miraba el número
-- interno, el correlativo y el cliente, así que aun sin el timeout (corregido en
-- ventas_busqueda_entra_por_llave) la respuesta habría sido «Sin resultados».
-- Decisión del usuario el 2026-09-22: que la búsqueda de Ventas encuentre las
-- facturas que llevan ese producto.
--
-- Mismo criterio que las otras tres ramas: TODAS las palabras dentro del MISMO
-- campo —acá el nombre del producto (`nombre_norm`, que es norm_search(nombre)
-- en las 5,233 filas)—. Va en un UNION aparte para que cada rama conserve su
-- plan: la de siempre entra por los tres índices de trigramas de la factura;
-- ésta, por el de `products.nombre_norm` y después por
-- `idx_sii_product_invoice (erp_product_id, invoice_id)`.
--
-- Los renglones escritos como genérico (sin producto del catálogo) no entran:
-- no tienen producto al que parecerse, y su descripción no tiene índice.
--
-- Medido con literales, un año entero, todas las salas:
--   EXFORGE HCT      109 facturas     81 ms
--   CLOPERA            8 facturas     11 ms
--   losartan         467 facturas     35 ms
--   acetaminofen   5,583 facturas  1,153 ms
--   tab           63,109 facturas  1,024 ms  (peor caso realista)
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.search_ventas_ids(p_search text, p_fini date DEFAULT NULL::date, p_ffin date DEFAULT NULL::date)
 RETURNS TABLE(id bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_pats  text[];
  v_first text;
BEGIN
  SELECT array_agg('%' || tok || '%')
    INTO v_pats
    FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
   WHERE tok <> '';

  IF v_pats IS NULL THEN
    RETURN QUERY
    SELECT si.id
      FROM public.sales_invoices si
     WHERE (p_fini IS NULL OR si.fecha >= p_fini)
       AND (p_ffin IS NULL OR si.fecha <= p_ffin);
    RETURN;
  END IF;

  v_first := v_pats[1];

  RETURN QUERY
  SELECT si.id
    FROM public.sales_invoices si
   WHERE (p_fini IS NULL OR si.fecha >= p_fini)
     AND (p_ffin IS NULL OR si.fecha <= p_ffin)
     AND (
          (public.norm_search(si.erp_invoice_id) LIKE v_first
           AND public.norm_search(si.erp_invoice_id) LIKE ALL (v_pats))
       OR (public.norm_search(si.correlativo)    LIKE v_first
           AND public.norm_search(si.correlativo)    LIKE ALL (v_pats))
       OR (public.norm_search(si.cliente)        LIKE v_first
           AND public.norm_search(si.cliente)        LIKE ALL (v_pats))
     )
  UNION
  -- Las facturas que llevan un producto cuyo nombre tiene todas las palabras.
  SELECT si.id
    FROM public.sales_invoices si
   WHERE (p_fini IS NULL OR si.fecha >= p_fini)
     AND (p_ffin IS NULL OR si.fecha <= p_ffin)
     AND si.id IN (
           SELECT ii.invoice_id
             FROM public.sales_invoice_items ii
            WHERE ii.erp_product_id IN (
                  SELECT pr.id
                    FROM public.products pr
                   WHERE pr.nombre_norm LIKE v_first
                     AND pr.nombre_norm LIKE ALL (v_pats)));
END;
$function$;
