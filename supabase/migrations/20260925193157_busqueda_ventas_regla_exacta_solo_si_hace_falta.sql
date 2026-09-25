-- Buscar «maria» en Ventas sobre un año: 4,417 ms (medido por `gate:perf`,
-- techo 1,300). Pasan el prefiltro 15,762 facturas y a cada una se le aplicaba
-- la regla exacta. Con sólo palabras de 3+ letras el prefiltro YA es la regla
-- —una palabra coincide dentro de otra, y `norm_search` es la forma compacta—,
-- así que la regla exacta se aplica sólo cuando hace falta: números, palabras
-- cortas o mixtas. Mismos resultados.
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
            WHERE ii.erp_product_id IN (
                  SELECT b.id FROM public.busqueda_productos(p_search, false, false, false) b
                   WHERE NOT b.aproximado));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RETURN; END IF;

  -- Nada tal cual: las facturas con productos PARECIDOS.
  RETURN QUERY
  SELECT si.id, true
    FROM public.sales_invoices si
   WHERE (p_fini IS NULL OR si.fecha >= p_fini)
     AND (p_ffin IS NULL OR si.fecha <= p_ffin)
     AND (v_sala IS NULL OR si.branch_id = v_sala)
     AND si.id IN (
           SELECT ii.invoice_id
             FROM public.sales_invoice_items ii
            WHERE ii.erp_product_id IN (
                  SELECT b.id FROM public.busqueda_productos(p_search, false, false, false) b
                   WHERE b.aproximado));
END;
$function$;

CREATE OR REPLACE FUNCTION public.ventas_busqueda_aproximada(p_search text, p_fini date DEFAULT NULL::date, p_ffin date DEFAULT NULL::date)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
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
BEGIN
  IF v_pats IS NULL THEN RETURN false; END IF;
  SELECT a.puede, a.sala INTO v_puede, v_sala FROM public.alcance_de_ventas() a;
  IF NOT coalesce(v_puede, false) THEN RETURN false; END IF;

  IF EXISTS (SELECT 1 FROM public.busqueda_productos(p_search, false, false, false) b WHERE NOT b.aproximado) THEN
    RETURN false;
  END IF;

  v_first := v_pats[1];
  RETURN NOT EXISTS (
    SELECT 1
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
  );
END;
$function$;
