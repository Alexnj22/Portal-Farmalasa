-- Buscar una factura tardaba 7.5 segundos (auditoría 2026-07-29, P3 + P5)
--
-- La auditoría reportó esto como DOS hallazgos separados:
--   P3 — "6 GIN de trigram muertos, 0 scans, dropearlos (~117 MB)"
--   P5 — "las RPCs de analítica más lentas (7,669 ms de media)"
-- Son el mismo bug. Los índices están muertos PORQUE la query no puede usarlos,
-- y la query es lenta por exactamente esa razón. Dropearlos como pedía P3
-- habría dejado la búsqueda en 7.5 s para siempre.
--
-- La causa: `search_ventas_ids` filtraba con
--
--     public.norm_search(si.cliente) LIKE ALL (pats.v_pats)
--
-- `LIKE ALL (array)` es un ScalarArrayOpExpr, y el opclass `gin_trgm_ops` solo
-- sabe resolver `LIKE` contra un patrón ESCALAR. Además `pats` venía de un CTE
-- unido por producto cartesiano, así que el predicado referenciaba otra relación
-- y dejaba de ser indexable por construcción. Resultado: seq scan sobre 336,592
-- filas evaluando norm_search() tres veces por fila.
--
-- El arreglo es pasar a plpgsql y dejar los patrones en variables locales: así
-- llegan al plan como parámetros escalares y `norm_search(col) LIKE $n` sí matchea
-- el índice de expresión. Se conserva el AND multi-token agregando el `LIKE ALL`
-- como filtro sobre el heap, después de que el índice ya recortó los candidatos.
--
--   medido con 'rodriguez' sobre 2026-01-01..2026-07-29, mismas 2,072 filas:
--     antes  6,720 ms
--     después  461 ms
--
--   equivalencia verificada por diferencia de conjuntos de ids en 7 casos
--   (multi-token, 2 caracteres, vacío, acentos, barra): 0 diferencias.
--
--   y los tres índices _norm pasaron de 0 a 29 idx_scan — o sea ahora se usan.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.search_ventas_ids(
  p_search text,
  p_fini   date DEFAULT NULL,
  p_ffin   date DEFAULT NULL
)
RETURNS TABLE(id bigint)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_pats  text[];
  v_first text;
BEGIN
  SELECT array_agg('%' || tok || '%')
    INTO v_pats
    FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
   WHERE tok <> '';

  -- Búsqueda vacía: se comporta igual que antes (solo filtra por fecha).
  IF v_pats IS NULL THEN
    RETURN QUERY
    SELECT si.id
      FROM public.sales_invoices si
     WHERE (p_fini IS NULL OR si.fecha >= p_fini)
       AND (p_ffin IS NULL OR si.fecha <= p_ffin);
    RETURN;
  END IF;

  -- Escalar: esto es lo que el índice GIN de trigram puede resolver.
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
     );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_ventas_ids(text, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.search_ventas_ids(text, date, date) TO authenticated, service_role;

-- Índices de trigram sobre la columna CRUDA: superados por sus gemelos _norm,
-- que son los que la RPC consulta. 0 scans mientras los _norm suben. 53 MB.
DROP INDEX IF EXISTS public.idx_si_cliente_trgm;
DROP INDEX IF EXISTS public.idx_si_correlativo_trgm;
DROP INDEX IF EXISTS public.idx_si_erp_invoice_trgm;

-- Prefijo estricto de idx_si_branch_fecha_full (mismas columnas líderes, y ese
-- se usa 200 veces más). 11 MB.
DROP INDEX IF EXISTS public.idx_sales_invoices_branch_fecha;

-- NO se dropean:
--   sales_invoices_codigo_generacion_key  → es el UNIQUE del UUID del DTE.
--     idx_scan=0 no significa que no sirva: es integridad de datos.
--   idx_si_*_norm_trgm (3)                → ahora sí se usan, ver arriba.
--   idx_sales_invoices_cod_vendedor,
--   idx_si_branch_fecha_no_anulada        → 0 scans en 9 días y 10 MB entre los
--     dos, pero no pude probar que ningún reporte mensual los use. Se dejan.
