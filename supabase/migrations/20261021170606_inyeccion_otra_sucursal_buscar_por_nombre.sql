SET lock_timeout = '5s';

-- Inyección comprada en otra sucursal: además del comprobante, se busca por el
-- NOMBRE del cliente (usuario, 2026-10-21: «si un cliente no lleva el ticket,
-- no se sabe cómo buscar»). Texto con letras = nombre; sólo dígitos = comprobante;
-- uuid = código de generación. Por nombre trae sólo ventas CON inyección y
-- válidas de los últimos 90 días, de todas las salas, hasta 20.
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
    -- El correlativo del ticket, con o sin ceros y con o sin el «_COF».
    v_num := ltrim(regexp_replace(split_part(v_q, '_', 1), '[^0-9]', '', 'g'), '0');
    IF v_num = '' THEN RAISE EXCEPTION 'Escribe el número de comprobante del ticket o el nombre del cliente.'; END IF;
    SELECT array_agg(si.id) INTO v_ids
    FROM (
      SELECT si.id FROM sales_invoices si
      WHERE si.fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - 90
        -- El LIKE entra por el índice trigram del correlativo: sin él la
        -- búsqueda recorría las ~61,000 ventas de 90 días (30,415 bloques por
        -- llamada); con él, 66. La igualdad de abajo es la que decide.
        AND public.norm_search(si.correlativo) LIKE '%' || v_num || '%'
        AND ltrim(split_part(si.correlativo, '_', 1), '0') = v_num
      ORDER BY si.fecha DESC LIMIT 10
    ) si;
  END IF;

  RETURN json_build_object('ventas', coalesce((
    SELECT json_agg(x ORDER BY x.propia DESC, x.fecha DESC, x.id DESC)
    FROM (
      SELECT si.id, si.branch_id, b.name AS sala, (si.branch_id = p_branch_id) AS propia,
             si.fecha, to_char(si.hora, 'HH24:MI') AS hora, si.correlativo, si.cliente,
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
                 'opciones_ml', r.opciones_ml, 'dosis_ml', r.dosis_ml
               ) ORDER BY r.linea_num) AS renglones,
               sum(r.disponibles) AS disponibles
        FROM public.inyeccion_renglones_de_venta(ARRAY[si.id]) r
      ) rr ON true
      WHERE si.id = ANY (coalesce(v_ids, '{}'))
    ) x
  ), '[]'::json));
END;
$function$;
