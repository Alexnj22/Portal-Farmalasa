SET lock_timeout = '5s';
-- Ventas con inyección para cobrar (2026-10-05): la lista sin buscar mira 30
-- días (antes 7), y al buscar por CLIENTE o FACTURA se mira hasta 90 días. La
-- búsqueda por nombre de la inyección se queda en la ventana normal: es la que
-- revisa renglón por renglón; por encabezado los 90 días cuestan ~86 ms en la
-- sala más movida (la versión con los tres criterios a 90 días, 446 ms).
CREATE OR REPLACE FUNCTION public.inyecciones_para_cobrar(p_branch_id integer, p_buscar text DEFAULT NULL::text, p_dias integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_ids    bigint[];
  v_buscar text := nullif(upper(trim(coalesce(p_buscar, ''))), '');
  v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_desde  date := v_hoy - greatest(least(coalesce(p_dias, 30), 31), 0);
  v_desde_buscar date := v_hoy - 90;
BEGIN
  IF NOT (SELECT auth_has_module_permission('caja_vales', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  -- Igual que `operar-caja`: sin alcance total, sólo la sala propia.
  IF coalesce((SELECT auth_module_scope('caja_vales')), '') <> 'ALL'
     AND p_branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(si.id) INTO v_ids
  FROM sales_invoices si
  WHERE si.branch_id = p_branch_id
    AND si.fecha >= CASE WHEN v_buscar IS NULL THEN v_desde ELSE least(v_desde, v_desde_buscar) END
    AND public.venta_valida(si.estado)
    -- Se busca por cliente o factura (90 días) o por la INYECCIÓN (ventana normal).
    AND (v_buscar IS NULL
         OR upper(si.cliente) LIKE '%' || v_buscar || '%'
         OR si.correlativo LIKE '%' || v_buscar || '%'
         OR (si.fecha >= v_desde
             AND EXISTS (SELECT 1 FROM sales_invoice_items ii
                         WHERE ii.invoice_id = si.id
                           AND upper(ii.descripcion) LIKE '%' || v_buscar || '%')))
    AND EXISTS (SELECT 1 FROM sales_invoice_items ii
                LEFT JOIN inyeccion_producto_clasificacion cl ON cl.erp_product_id = ii.erp_product_id
                WHERE ii.invoice_id = si.id
                  AND coalesce(cl.es_inyeccion, public.es_inyectable(ii.descripcion)));

  RETURN coalesce((
    SELECT json_agg(v ORDER BY v.fecha DESC, v.hora DESC NULLS LAST, v.id DESC)
    FROM (
      SELECT si.id, si.fecha, to_char(si.hora, 'HH24:MI') AS hora, si.correlativo, si.cliente,
             si.customer_id, si.cod_vendedor, ev.name AS vendedor_nombre, ev.id AS vendedor_id,
             json_agg(json_build_object(
               'linea_num', r.linea_num, 'descripcion', r.descripcion, 'presentacion', r.presentacion,
               'cantidad', r.cantidad, 'por_unidad', r.por_unidad, 'confirmado', r.confirmado,
               'total', r.total, 'usadas', r.usadas, 'disponibles', r.disponibles,
               -- Por ml: la pantalla calcula el saldo de cada dosis con esto.
               'unidades', r.unidades, 'contenido_ml', r.contenido_ml,
               'opciones_ml', r.opciones_ml, 'dosis_ml', r.dosis_ml
             ) ORDER BY r.linea_num) AS renglones,
             sum(r.disponibles) AS disponibles,
             -- Quién y cuándo la cobró la última vez: una venta ya cobrada entera
             -- SIGUE en la lista, deshabilitada, diciendo por qué (2026-10-05).
             (SELECT json_build_object('por', ec.name, 'por_id', c.registrado_por, 'at', c.registrado_at)
                FROM inyeccion_aplicaciones a
                JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
                LEFT JOIN employees ec ON ec.id = c.registrado_por
               WHERE a.invoice_id = si.id AND a.confirmada
               ORDER BY c.registrado_at DESC LIMIT 1) AS ultimo_cobro
      FROM sales_invoices si
      JOIN public.inyeccion_renglones_de_venta(v_ids) r ON r.invoice_id = si.id
      LEFT JOIN employees ev ON ev.code = si.cod_vendedor
      WHERE si.id = ANY (v_ids)
      GROUP BY si.id, ev.name, ev.id
      -- Las ya cobradas enteras TAMBIÉN van (2026-10-05): la pantalla las
      -- muestra deshabilitadas con quién y cuándo las cobró.
      ORDER BY si.fecha DESC, si.hora DESC NULLS LAST
      LIMIT 150
    ) v
  ), '[]'::json);
END;
$function$;
