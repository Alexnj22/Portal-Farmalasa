SET lock_timeout = '5s';
-- jsonb-agg: listas de los productos de UNA factura (un puñado de filas), y en jsonb porque json no tiene igualdad para `IS DISTINCT FROM`.

-- El comparador del ensayo leía mal el código del producto (2026-11-18). La
-- caja lo manda como lo copia su pantalla: con saltos de línea y espacios
-- alrededor («\n            4652\n        »), y `btrim` sólo quita espacios. La
-- primera comparación real (preventa 415606, Salud 1, $17.15) salió «no
-- cuadra» con la lista del ensayo vacía, cuando los 4 productos y el total
-- eran idénticos. Se quita todo espacio en blanco, y se vuelven a comparar las
-- que ya se compararon con el error.

CREATE OR REPLACE FUNCTION public.cobro_caja_ensayo_comparar()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_comparadas int := 0;
  v_fallidas   int := 0;
  v_sin        int := 0;
  v_purgadas   int := 0;
BEGIN
  -- Las que tienen factura (con sus productos ya sincronizados) y un plan armado.
  WITH pend AS (
    SELECT e.id, e.plan, s.id AS sid, s.total AS s_total, s.tipo_documento AS s_tipo, s.cod_vendedor AS s_vend
      FROM public.cobro_caja_ensayos e
      JOIN public.sales_invoices s ON s.erp_invoice_id = e.externo_id AND s.branch_id = e.branch_id
     WHERE e.comparado_at IS NULL
       AND e.plan ? 'guardado'
       AND s.created_at < now() - interval '2 minutes'
       AND EXISTS (SELECT 1 FROM public.sales_invoice_items i WHERE i.invoice_id = s.id)
  ), cmp AS (
    SELECT p.id,
           jsonb_strip_nulls(jsonb_build_object(
             'total', CASE WHEN abs(coalesce((p.plan->'totales'->>'total')::numeric, -1) - p.s_total) >= 0.005
                           THEN jsonb_build_object('ensayo', (p.plan->'totales'->>'total')::numeric, 'caja', p.s_total) END,
             'documento', CASE WHEN p.plan->'cabecera'->>'tipo_documento' IS DISTINCT FROM p.s_tipo
                               THEN jsonb_build_object('ensayo', p.plan->'cabecera'->>'tipo_documento', 'caja', p.s_tipo) END,
             'vendedor', CASE WHEN nullif(p.plan->'cabecera'->>'codvende', '') IS DISTINCT FROM nullif(p.s_vend, '')
                              THEN jsonb_build_object('ensayo', p.plan->'cabecera'->>'codvende', 'caja', p.s_vend) END,
             'productos', CASE WHEN a.lineas IS DISTINCT FROM b.lineas
                               THEN jsonb_build_object('ensayo', a.lineas, 'caja', b.lineas) END
           )) AS dif
      FROM pend p
      CROSS JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_array(pid, round(sub, 2)) ORDER BY pid) AS lineas
          FROM (SELECT regexp_replace(r->>'id', '\s', '', 'g')::bigint AS pid, sum(replace(r->>'subtotal', ',', '')::numeric) AS sub
                  FROM jsonb_array_elements((p.plan->'guardado'->>'json_arr')::jsonb) r
                 WHERE regexp_replace(r->>'id', '\s', '', 'g') ~ '^[0-9]+$'
                 GROUP BY 1) x) a
      CROSS JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_array(erp_product_id, round(t, 2)) ORDER BY erp_product_id) AS lineas
          FROM (SELECT i.erp_product_id, sum(i.total_linea) AS t
                  FROM public.sales_invoice_items i WHERE i.invoice_id = p.sid GROUP BY 1) y) b
  )
  UPDATE public.cobro_caja_ensayos e
     SET comparado_at = now(), cuadra = (c.dif = '{}'::jsonb), diferencias = nullif(c.dif, '{}'::jsonb)
    FROM cmp c WHERE c.id = e.id;
  GET DIAGNOSTICS v_comparadas = ROW_COUNT;

  -- El ensayo no se pudo armar y la venta igual se cobró: cuenta como falla del ensayo.
  UPDATE public.cobro_caja_ensayos e
     SET comparado_at = now(), cuadra = false,
         diferencias = jsonb_build_object('ensayo_fallo', e.plan->>'error')
   WHERE e.comparado_at IS NULL AND NOT (e.plan ? 'guardado')
     AND EXISTS (SELECT 1 FROM public.sales_invoices s WHERE s.erp_invoice_id = e.externo_id AND s.branch_id = e.branch_id);
  GET DIAGNOSTICS v_fallidas = ROW_COUNT;

  -- Dos días sin factura: la preventa se borró o nunca se cobró. No se juzga.
  UPDATE public.cobro_caja_ensayos e
     SET comparado_at = now(), cuadra = NULL, diferencias = jsonb_build_object('sin_factura', true)
   WHERE e.comparado_at IS NULL AND e.captado_at < now() - interval '2 days';
  GET DIAGNOSTICS v_sin = ROW_COUNT;

  DELETE FROM public.cobro_caja_ensayos WHERE created_at < now() - interval '60 days';
  GET DIAGNOSTICS v_purgadas = ROW_COUNT;

  RETURN json_build_object('comparadas', v_comparadas, 'fallidas', v_fallidas, 'sin_factura', v_sin, 'purgadas', v_purgadas);
END;
$$;

UPDATE public.cobro_caja_ensayos
   SET comparado_at = NULL, cuadra = NULL, diferencias = NULL
 WHERE comparado_at IS NOT NULL AND diferencias ? 'productos'
   AND diferencias->'productos'->'ensayo' IS NULL;

SELECT public.cobro_caja_ensayo_comparar();
