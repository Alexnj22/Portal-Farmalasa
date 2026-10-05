-- ════════════════════════════════════════════════════════════════════════════
-- Inyecciones: la venta ya cobrada SIGUE en la lista del cobro (2026-10-05)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Reporte de Salud 1: «no salió en el listado la de 1 MESIGYNA». Estaba bien:
-- la había cobrado otra persona 5 minutos después de la venta, y la lista sólo
-- mostraba ventas con algo por pagar — así que para quien llegó después la
-- venta «no existía». Pedido del usuario: «si ya está cobrada, que siempre
-- salga, pero deshabilitada o algo que diga que ya se cobró».
--
-- Se quita el `HAVING sum(disponibles) > 0` y cada venta trae `ultimo_cobro`
-- (quién y cuándo). La pantalla la pinta deshabilitada con «Ya cobrada». El
-- tope sube de 80 a 150 ventas: con las cobradas adentro, una sala grande pasa
-- de 80 en siete días.
-- ════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.inyecciones_para_cobrar(p_branch_id integer, p_buscar text DEFAULT NULL::text, p_dias integer DEFAULT 7)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_ids    bigint[];
  v_buscar text := nullif(upper(trim(coalesce(p_buscar, ''))), '');
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
    AND si.fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - greatest(least(coalesce(p_dias, 7), 31), 0)
    AND public.venta_valida(si.estado)
    AND EXISTS (SELECT 1 FROM sales_invoice_items ii
                LEFT JOIN inyeccion_producto_clasificacion cl ON cl.erp_product_id = ii.erp_product_id
                WHERE ii.invoice_id = si.id
                  AND coalesce(cl.es_inyeccion, public.es_inyectable(ii.descripcion))
                  -- Se busca por cliente, por factura o por la INYECCIÓN.
                  AND (v_buscar IS NULL
                       OR upper(si.cliente) LIKE '%' || v_buscar || '%'
                       OR si.correlativo LIKE '%' || v_buscar || '%'
                       OR upper(ii.descripcion) LIKE '%' || v_buscar || '%'));

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