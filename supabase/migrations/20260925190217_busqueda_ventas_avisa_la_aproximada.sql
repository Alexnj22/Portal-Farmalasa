-- ¿La búsqueda de Ventas cae en la aproximada? Para que la lista de facturas
-- lo AVISE (docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md): esa lista se arma con
-- `get_ventas_con_receta`, que usa `search_ventas_ids` por dentro y no devuelve
-- su columna `aproximado`.
--
-- Contesta lo mismo que `search_ventas_ids` decide, sin repetir la búsqueda:
-- es aproximada sólo si NINGÚN producto coincide tal cual y NINGUNA factura
-- del rango coincide por id, correlativo o cliente. Las dos preguntas son
-- `EXISTS`: cortan en la primera coincidencia, que es el caso común.
-- DEFINER y con `alcance_de_ventas()` por lo mismo que `search_ventas_ids`.
SET lock_timeout = '5s';

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
             AND public.busqueda_coincide(v_tok, si.erp_invoice_id))
         OR (public.norm_search(si.correlativo)    LIKE v_first
             AND public.norm_search(si.correlativo)    LIKE ALL (v_pats)
             AND public.busqueda_coincide(v_tok, si.correlativo))
         OR (public.norm_search(si.cliente)        LIKE v_first
             AND public.norm_search(si.cliente)        LIKE ALL (v_pats)
             AND public.busqueda_coincide(v_tok, si.cliente))
       )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ventas_busqueda_aproximada(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ventas_busqueda_aproximada(text, date, date) TO authenticated, service_role;
