-- `busqueda_productos` corría la aproximada siempre que no hubiera coincidencia
-- exacta, también para quien sólo quería saber si la había: Ventas pagaba
-- 228 ms por «maria» (ningún producto se llama así) en cada búsqueda. Ahora
-- `p_con_aproximada = false` la salta, y la aproximada mira sólo a los 300
-- más cercanos por trigramas. Se recrea porque cambia la firma; sus llamadores
-- de plpgsql la llaman con 4 argumentos y el quinto tiene default.
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.busqueda_productos(text, boolean, boolean, boolean);

CREATE FUNCTION public.busqueda_productos(
  p_q text,
  p_con_pactivo boolean DEFAULT false,
  p_con_laboratorio boolean DEFAULT false,
  p_solo_activos boolean DEFAULT true,
  -- false = sólo la exacta. Para quien la necesita sola (Ventas) y no puede
  -- pagar la aproximada: sin coincidencia exacta, ésta recorría el catálogo.
  p_con_aproximada boolean DEFAULT true
)
RETURNS TABLE(id integer, puntaje numeric, aproximado boolean)
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
#variable_conflict use_column
DECLARE
  v_tok  jsonb := public.busqueda_palabras(p_q);
  v_pats text[];
  v_n    int;
BEGIN
  IF jsonb_array_length(v_tok) = 0 THEN RETURN; END IF;
  v_pats := public.busqueda_prefiltro(v_tok);

  -- Exacta
  RETURN QUERY
  WITH labs AS (
    SELECT l.id AS lab_id, public.norm_busqueda(l.nombre) lb, public.compactar_busqueda(l.nombre) lc
    FROM public.laboratorios l
    WHERE p_con_laboratorio
  ),
  cand AS (
    SELECT p.id AS pid,
           public.busqueda_puntaje(v_tok,
             ARRAY[p.nombre_busq, CASE WHEN p_con_pactivo THEN p.pactivo_busq END, lb.lb, p.codigo_barras],
             ARRAY[p.nombre_comp, CASE WHEN p_con_pactivo THEN p.pactivo_comp END, lb.lc, p.codigo_barras])::numeric AS s
    FROM public.products p
    LEFT JOIN labs lb ON lb.lab_id = p.laboratorio_id
    WHERE (NOT p_solo_activos OR p.activo)
      AND (p.busq_todo || coalesce(' ' || lb.lb || ' ' || lb.lc, '')) ~ ALL (v_pats)
  )
  SELECT c.pid, c.s, false FROM cand c WHERE c.s > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 OR NOT p_con_aproximada THEN RETURN; END IF;

  -- Aproximada: sólo si lo exacto no trajo nada. Los trigramas ELIGEN
  -- candidatos con un umbral bajo a propósito («dicloefnac» contra DICLOFENAC
  -- da 0.47); el parecido exacto —el mismo de JS— decide. Puntaje 0–47.5 para
  -- que nunca empate con una exacta (≥ 60).
  RETURN QUERY
  WITH labs AS (
    SELECT l.id AS lab_id, public.norm_busqueda(l.nombre) lb, public.compactar_busqueda(l.nombre) lc
    FROM public.laboratorios l
    WHERE p_con_laboratorio
  ),
  -- Los 300 más cercanos por trigramas, y sobre ésos el parecido exacto:
  -- con un umbral de 0.3 pasaban cientos, y el parecido es caro por fila.
  cerca AS (
    SELECT p.id, p.nombre_busq, p.pactivo_busq, p.nombre_comp, p.pactivo_comp,
           p.codigo_barras, p.laboratorio_id
    FROM public.products p
    WHERE (NOT p_solo_activos OR p.activo)
      AND public.word_similarity(public.norm_busqueda(p_q), p.busq_todo) >= 0.3
    ORDER BY public.word_similarity(public.norm_busqueda(p_q), p.busq_todo) DESC
    LIMIT 300
  ),
  cand AS (
    SELECT p.id AS pid,
           public.busqueda_parecido(v_tok,
             ARRAY[p.nombre_busq, CASE WHEN p_con_pactivo THEN p.pactivo_busq END, lb.lb, p.codigo_barras],
             ARRAY[p.nombre_comp, CASE WHEN p_con_pactivo THEN p.pactivo_comp END, lb.lc, p.codigo_barras]) AS s
    FROM cerca p
    LEFT JOIN labs lb ON lb.lab_id = p.laboratorio_id
  )
  SELECT c.pid, c.s * 50, true FROM cand c WHERE c.s >= 0.75;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.busqueda_productos(text, boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.busqueda_productos(text, boolean, boolean, boolean, boolean) TO authenticated, service_role;

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
                  SELECT b.id FROM public.busqueda_productos(p_search, false, false, false, false) b));
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

  IF EXISTS (SELECT 1 FROM public.busqueda_productos(p_search, false, false, false, false)) THEN
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
