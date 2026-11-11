-- `_docs_sin_numero_control('inyecciones')` tardaba 6 s (medido 2026-11-10):
-- `es_inyectable` (una regex, no se inlinea) corría sobre los ~700,000
-- renglones de venta, no sólo los de 90 días, y la función `sql` con SET
-- nace genérica, así que el plan tampoco descartaba la rama de los libros.
--
-- Ahora es plpgsql y cada alcance es su propia consulta:
--   · 'inyecciones'    → últimos 3 días: lo del cron de cada 10 min (~80 ms).
--   · 'inyecciones_90' → la ventana del buscador, para el relleno de una vez.
--   · 'libros'         → lo de siempre, sin cambios.
-- El renglón se mira por venta (LATERAL … LIMIT 1): la regex corre sólo sobre
-- los renglones de las ventas candidatas, y para en el primero que es inyección.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public._docs_sin_numero_control(p_alcance text DEFAULT 'libros')
 RETURNS TABLE(id bigint, codigo_generacion uuid, fecha date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_alcance IN ('inyecciones', 'inyecciones_90') THEN
    RETURN QUERY
      SELECT si.id, si.codigo_generacion, si.fecha
      FROM public.sales_invoices si
      CROSS JOIN LATERAL (
        SELECT 1 FROM public.sales_invoice_items ii
        LEFT JOIN public.inyeccion_producto_clasificacion cl ON cl.erp_product_id = ii.erp_product_id
        WHERE ii.invoice_id = si.id
          AND coalesce(cl.es_inyeccion, public.es_inyectable(ii.descripcion))
        LIMIT 1
      ) iny
      WHERE si.codigo_generacion IS NOT NULL
        AND si.numero_control IS NULL
        AND si.fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date
                        - CASE WHEN p_alcance = 'inyecciones_90' THEN 90 ELSE 3 END
        AND public.venta_valida(si.estado);
    RETURN;
  END IF;

  RETURN QUERY
    WITH universo AS (
        SELECT si.id, si.codigo_generacion, si.branch_id, si.fecha,
               si.tipo_documento, si.estado, si.numero_control, si.recibido_mh,
               nullif(regexp_replace(si.correlativo, '\D', '', 'g'), '')::bigint AS corr_num
        FROM public.sales_invoices si
        WHERE si.codigo_generacion IS NOT NULL
          AND si.fecha >= '2025-05-01'
    ),
    ccf AS (
        SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control FROM universo u
        WHERE u.tipo_documento = 'CCF' AND public.venta_fiscal(u.estado, u.recibido_mh)
    ),
    anul AS (
        -- Sin filtro de sello: get_libro_anulados tampoco lo tiene.
        SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control FROM universo u
        WHERE u.estado = 'DTE INVALIDADO EN MH'
    ),
    extremos AS (
        SELECT x.id, x.codigo_generacion, x.fecha, x.numero_control FROM (
            SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control,
                   row_number() OVER (PARTITION BY u.branch_id, u.fecha ORDER BY u.corr_num ASC NULLS LAST)  AS r_asc,
                   row_number() OVER (PARTITION BY u.branch_id, u.fecha ORDER BY u.corr_num DESC NULLS LAST) AS r_desc
            FROM universo u
            WHERE u.tipo_documento = 'COF' AND public.venta_fiscal(u.estado, u.recibido_mh)
        ) x
        WHERE x.r_asc = 1 OR x.r_desc = 1
    ),
    todos AS (
        SELECT * FROM ccf UNION SELECT * FROM anul UNION SELECT * FROM extremos
    )
    SELECT t.id, t.codigo_generacion, t.fecha
    FROM todos t
    WHERE t.numero_control IS NULL;
END;
$function$;
