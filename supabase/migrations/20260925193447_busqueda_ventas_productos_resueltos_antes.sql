-- `search_ventas_ids` llamaba a `busqueda_productos` DENTRO de la consulta, y
-- como esa función no es PARALLEL SAFE la consulta entera perdía los workers en
-- paralelo: «maria» sobre un año tardaba 1,304 ms contra 702 de la versión
-- vieja, medida recreándola igual. Los productos se resuelven antes, en un
-- arreglo. Mismos resultados.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.search_ventas_ids(p_search text, p_fini date DEFAULT NULL::date, p_ffin date DEFAULT NULL::date)
 RETURNS TABLE(id bigint, aproximado boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
DECLARE
  v_tok   jsonb  := public.busqueda_palabras(p_search);
  v_pats  text[] := public.busqueda_patrones_legados(public.busqueda_palabras(p_search));
  -- Con sólo palabras de 3+ letras, el `LIKE` sobre `norm_search` ya da lo
  -- mismo que la regla (una palabra coincide dentro de otra, y `norm_search`
  -- es la forma compacta): la regla exacta sobra. Hace falta con números
  -- (completos), palabras cortas (al inicio) o mixtas (seguidas).
  v_basta_like boolean := NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.busqueda_palabras(p_search)) x
    WHERE x->>'tipo' <> 'palabra');
  v_first text;
  v_puede boolean;
  v_sala  integer;
  v_n     int;
  v_prods int[];
BEGIN
  -- DEFINER para que el `LIKE` entre al índice de trigramas; el alcance del
  -- RLS lo pone `alcance_de_ventas()`.
  SELECT a.puede, a.sala INTO v_puede, v_sala FROM public.alcance_de_ventas() a;
  IF NOT coalesce(v_puede, false) THEN RETURN; END IF;

  IF v_pats IS NULL THEN
    RETURN QUERY
    SELECT si.id, false
      FROM public.sales_invoices si
     WHERE (p_fini IS NULL OR si.fecha >= p_fini)
       AND (p_ffin IS NULL OR si.fecha <= p_ffin)
       AND (v_sala IS NULL OR si.branch_id = v_sala);
    RETURN;
  END IF;

  v_first := v_pats[1];
  -- Los productos, resueltos ANTES y como arreglo. Llamar a
  -- `busqueda_productos` dentro de la consulta la dejaba sin workers en
  -- paralelo (la función no es PARALLEL SAFE): 1,304 ms contra 702 de la vieja.
  v_prods := ARRAY(SELECT b.id FROM public.busqueda_productos(p_search, false, false, false, false) b);

  RETURN QUERY
  SELECT si.id, false
    FROM public.sales_invoices si
   WHERE (p_fini IS NULL OR si.fecha >= p_fini)
     AND (p_ffin IS NULL OR si.fecha <= p_ffin)
     AND (v_sala IS NULL OR si.branch_id = v_sala)
     AND (
          (public.norm_search(si.erp_invoice_id) LIKE v_first
           AND public.norm_search(si.erp_invoice_id) LIKE ALL (v_pats)
           AND (v_basta_like OR public.busqueda_coincide(v_tok, si.erp_invoice_id)))
       OR (public.norm_search(si.correlativo)    LIKE v_first
           AND public.norm_search(si.correlativo)    LIKE ALL (v_pats)
           AND (v_basta_like OR public.busqueda_coincide(v_tok, si.correlativo)))
       OR (public.norm_search(si.cliente)        LIKE v_first
           AND public.norm_search(si.cliente)        LIKE ALL (v_pats)
           AND (v_basta_like OR public.busqueda_coincide(v_tok, si.cliente)))
     )
  UNION
  -- Las facturas que llevan un producto que coincide tal cual.
  SELECT si.id, false
    FROM public.sales_invoices si
   WHERE (p_fini IS NULL OR si.fecha >= p_fini)
     AND (p_ffin IS NULL OR si.fecha <= p_ffin)
     AND (v_sala IS NULL OR si.branch_id = v_sala)
     AND si.id IN (
           SELECT ii.invoice_id
             FROM public.sales_invoice_items ii
            WHERE ii.erp_product_id = ANY (v_prods));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RETURN; END IF;

  -- Nada tal cual: las facturas con productos PARECIDOS.
  v_prods := ARRAY(SELECT b.id FROM public.busqueda_productos(p_search, false, false, false) b WHERE b.aproximado);
  RETURN QUERY
  SELECT si.id, true
    FROM public.sales_invoices si
   WHERE (p_fini IS NULL OR si.fecha >= p_fini)
     AND (p_ffin IS NULL OR si.fecha <= p_ffin)
     AND (v_sala IS NULL OR si.branch_id = v_sala)
     AND si.id IN (
           SELECT ii.invoice_id
             FROM public.sales_invoice_items ii
            WHERE ii.erp_product_id = ANY (v_prods));
END;
$function$;
