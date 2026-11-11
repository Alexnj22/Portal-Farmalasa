-- Inyecciones: buscar la venta de otra sala por el NÚMERO DE CONTROL del ticket
-- (2026-11-10). El ticket impreso trae el número de control del DTE
-- (DTE-01-S003P001-000000000047959) y no el correlativo interno (93759): son
-- dos contadores independientes. La cajera escribía 47959, el buscador lo
-- comparaba con el correlativo y traía otras ventas o nada.
--
-- Dos piezas:
--   1. `numero_control` sólo se traía para los libros (CCF, anuladas, extremos
--      del día). Ahora `_docs_sin_numero_control('inyecciones')` agrega las
--      ventas con inyección de los últimos 90 días — la misma ventana del
--      buscador —, y un cron cada 10 min las completa (migración aparte).
--   2. `inyeccion_venta_por_comprobante` acepta el número de control completo o
--      sólo su número final, además del correlativo.
SET lock_timeout = '5s';

-- Ya creado con CONCURRENTLY desde fuera de la transacción (tabla caliente);
-- acá queda para que el esquema se reconstruya igual.
CREATE INDEX IF NOT EXISTS idx_si_numero_control_num
  ON public.sales_invoices (ltrim(split_part(numero_control, '-', 4), '0'))
  WHERE numero_control IS NOT NULL;

DROP FUNCTION IF EXISTS public.get_docs_sin_numero_control(integer);
DROP FUNCTION IF EXISTS public.count_docs_sin_numero_control();
DROP FUNCTION IF EXISTS public._docs_sin_numero_control();

-- p_alcance: 'libros' (lo de siempre, el cron diario) o 'inyecciones' (sólo
-- las ventas con inyección de 90 días: barato, para el cron de cada 10 min).
CREATE FUNCTION public._docs_sin_numero_control(p_alcance text DEFAULT 'libros')
 RETURNS TABLE(id bigint, codigo_generacion uuid, fecha date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH universo AS (
        SELECT si.id, si.codigo_generacion, si.branch_id, si.fecha,
               si.tipo_documento, si.estado, si.numero_control, si.recibido_mh,
               nullif(regexp_replace(si.correlativo, '\D', '', 'g'), '')::bigint AS corr_num
        FROM public.sales_invoices si
        WHERE p_alcance = 'libros'
          AND si.codigo_generacion IS NOT NULL
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
    -- Las ventas con inyección que el buscador de la caja puede encontrar: la
    -- ventana es la suya (90 días). Mismo criterio de «es inyección» que
    -- `inyeccion_venta_por_comprobante`.
    inyecciones AS (
        SELECT si.id, si.codigo_generacion, si.fecha, si.numero_control
        FROM public.sales_invoices si
        WHERE p_alcance = 'inyecciones'
          AND si.codigo_generacion IS NOT NULL
          AND si.numero_control IS NULL
          AND si.fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - 90
          AND public.venta_valida(si.estado)
          AND EXISTS (SELECT 1 FROM public.sales_invoice_items ii
                      LEFT JOIN public.inyeccion_producto_clasificacion cl ON cl.erp_product_id = ii.erp_product_id
                      WHERE ii.invoice_id = si.id
                        AND coalesce(cl.es_inyeccion, public.es_inyectable(ii.descripcion)))
    ),
    todos AS (
        SELECT * FROM ccf UNION SELECT * FROM anul UNION SELECT * FROM extremos
        UNION SELECT * FROM inyecciones
    )
    SELECT t.id, t.codigo_generacion, t.fecha
    FROM todos t
    WHERE t.numero_control IS NULL;
$function$;

CREATE FUNCTION public.get_docs_sin_numero_control(p_limit integer DEFAULT 500, p_alcance text DEFAULT 'libros')
 RETURNS TABLE(id bigint, codigo_generacion uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    -- Más recientes primero: si el proveedor del ERP se cae a mitad del
    -- backfill, lo que queda sin traer es lo viejo, no el mes que está por
    -- declararse (ni la venta que la caja está buscando ahora).
    SELECT d.id, d.codigo_generacion
    FROM public._docs_sin_numero_control(p_alcance) d
    ORDER BY d.fecha DESC, d.id DESC
    LIMIT greatest(1, least(p_limit, 1000));
$function$;

CREATE FUNCTION public.count_docs_sin_numero_control(p_alcance text DEFAULT 'libros')
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT count(*)::int FROM public._docs_sin_numero_control(p_alcance);
$function$;

REVOKE EXECUTE ON FUNCTION public._docs_sin_numero_control(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_docs_sin_numero_control(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.count_docs_sin_numero_control(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._docs_sin_numero_control(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_docs_sin_numero_control(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_docs_sin_numero_control(text) TO service_role;

-- Partiendo de la definición VIVA (pg_get_functiondef, 2026-11-10). Cambia:
-- la rama del número de control completo, y la del número suelto, que ahora
-- busca también en el número de control.
CREATE OR REPLACE FUNCTION public.inyeccion_venta_por_comprobante(p_branch_id integer, p_comprobante text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_q        text := upper(trim(coalesce(p_comprobante, '')));
  v_num      text;
  v_ids      bigint[];
  v_palabras text[];
  v_larga    text;
BEGIN
  IF NOT (SELECT auth_has_module_permission('caja_vales', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  -- Quien cobra lo hace en la caja de SU sala (igual que `operar-caja`).
  IF coalesce((SELECT auth_module_scope('caja_vales')), '') <> 'ALL'
     AND p_branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_q ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' THEN
    -- Código de generación del DTE: único.
    SELECT array_agg(si.id) INTO v_ids
    FROM sales_invoices si WHERE si.codigo_generacion = v_q::uuid;  -- la columna es uuid: usa su índice único
  ELSIF v_q ~ '^DTE-[0-9]{2}-[A-Z0-9]{8}-[0-9]{1,15}$' THEN
    -- El número de control completo, como sale impreso en el ticket
    -- (DTE-01-S003P001-000000000047959). Tipo y punto de venta lo hacen único;
    -- el número entra por idx_si_numero_control_num.
    v_num := ltrim(split_part(v_q, '-', 4), '0');
    SELECT array_agg(si.id) INTO v_ids
    FROM sales_invoices si
    WHERE si.numero_control IS NOT NULL
      AND ltrim(split_part(si.numero_control, '-', 4), '0') = v_num
      AND upper(split_part(si.numero_control, '-', 2)) = split_part(v_q, '-', 2)
      AND upper(split_part(si.numero_control, '-', 3)) = split_part(v_q, '-', 3);
  ELSIF v_q ~ '[A-ZÁÉÍÓÚÑÜ]' AND split_part(v_q, '_', 2) <> 'COF' THEN
    -- El NOMBRE del cliente: cada palabra tiene que aparecer, en cualquier orden.
    SELECT array_agg(w ORDER BY length(w) DESC) INTO v_palabras
    FROM unnest(regexp_split_to_array(public.norm_search(v_q), '\s+')) w
    WHERE length(w) >= 2;
    IF coalesce(array_length(v_palabras, 1), 0) = 0 OR length(v_palabras[1]) < 3 THEN
      RAISE EXCEPTION 'Escribe al menos tres letras del nombre del cliente.';
    END IF;
    v_larga := v_palabras[1];
    SELECT array_agg(si.id) INTO v_ids
    FROM (
      SELECT si.id FROM sales_invoices si
      WHERE si.fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - 90
        -- La palabra más larga entra por el índice trigram del cliente (un GIN
        -- no acepta `LIKE ALL`); las demás filtran encima.
        AND public.norm_search(si.cliente) LIKE '%' || v_larga || '%'
        AND public.norm_search(si.cliente) LIKE ALL (SELECT '%' || w || '%' FROM unnest(v_palabras) w)
        AND public.venta_valida(si.estado)
        AND EXISTS (SELECT 1 FROM sales_invoice_items ii
                    LEFT JOIN inyeccion_producto_clasificacion cl ON cl.erp_product_id = ii.erp_product_id
                    WHERE ii.invoice_id = si.id
                      AND coalesce(cl.es_inyeccion, public.es_inyectable(ii.descripcion)))
      ORDER BY si.fecha DESC, si.hora DESC NULLS LAST LIMIT 20
    ) si;
  ELSE
    -- Un número suelto: el final del número de control (lo que trae el ticket)
    -- o el correlativo, con o sin ceros y con o sin el «_COF». Se buscan los
    -- dos: el ticket no imprime el correlativo, pero hay quien lo tiene.
    v_num := ltrim(regexp_replace(split_part(v_q, '_', 1), '[^0-9]', '', 'g'), '0');
    IF v_num = '' THEN RAISE EXCEPTION 'Escribe el número de control del ticket o el nombre del cliente.'; END IF;
    SELECT array_agg(s.id) INTO v_ids
    FROM (
      (SELECT si.id, si.fecha FROM sales_invoices si
       WHERE si.numero_control IS NOT NULL
         AND ltrim(split_part(si.numero_control, '-', 4), '0') = v_num
         AND si.fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - 90
       ORDER BY si.fecha DESC LIMIT 10)
      UNION
      (SELECT si.id, si.fecha FROM sales_invoices si
       WHERE si.fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - 90
         -- El LIKE entra por el índice trigram del correlativo: sin él la
         -- búsqueda recorría las ~61,000 ventas de 90 días (30,415 bloques por
         -- llamada); con él, 66. La igualdad de abajo es la que decide.
         AND public.norm_search(si.correlativo) LIKE '%' || v_num || '%'
         AND ltrim(split_part(si.correlativo, '_', 1), '0') = v_num
       ORDER BY si.fecha DESC LIMIT 10)
    ) s;
  END IF;

  RETURN json_build_object('ventas', coalesce((
    SELECT json_agg(x ORDER BY x.propia DESC, x.fecha DESC, x.id DESC)
    FROM (
      SELECT si.id, si.branch_id, b.name AS sala, (si.branch_id = p_branch_id) AS propia,
             si.fecha, to_char(si.hora, 'HH24:MI') AS hora, si.correlativo, si.numero_control, si.cliente,
             si.customer_id, si.cod_vendedor, ev.name AS vendedor_nombre, ev.id AS vendedor_id,
             coalesce(rr.renglones, '[]'::json) AS renglones, coalesce(rr.disponibles, 0) AS disponibles,
             CASE WHEN NOT public.venta_valida(si.estado) THEN 'anulada'
                  WHEN rr.renglones IS NULL THEN 'sin_inyeccion'
                  WHEN rr.disponibles <= 0 THEN 'pagada'
                  ELSE 'ok' END AS estado
      FROM sales_invoices si
      JOIN branches b ON b.id = si.branch_id
      LEFT JOIN employees ev ON ev.code = si.cod_vendedor
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
                 'linea_num', r.linea_num, 'descripcion', r.descripcion, 'presentacion', r.presentacion,
                 'cantidad', r.cantidad, 'por_unidad', r.por_unidad, 'confirmado', r.confirmado,
                 'total', r.total, 'usadas', r.usadas, 'disponibles', r.disponibles,
                 'unidades', r.unidades, 'contenido_ml', r.contenido_ml,
                 'opciones_ml', r.opciones_ml, 'dosis_ml', r.dosis_ml,
               -- El lote de la factura; si no identifica la ampolla, la caja lo escribe.
               'lote', nullif(upper(btrim(il.lote)), ''), 'vence', il.fecha_vencimiento,
               'pide_lote', public.inyeccion_lote_pide(il.lote)
               ) ORDER BY r.linea_num) AS renglones,
               sum(r.disponibles) AS disponibles
        FROM public.inyeccion_renglones_de_venta(ARRAY[si.id]) r
      LEFT JOIN sales_invoice_items il ON il.invoice_id = r.invoice_id AND il.linea_num = r.linea_num
      ) rr ON true
      WHERE si.id = ANY (coalesce(v_ids, '{}'))
    ) x
  ), '[]'::json));
END;
$function$;
