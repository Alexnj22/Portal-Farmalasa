-- La evidencia de los COF de la noche se ve en Libros IVA (2026-10-19).
--
-- Esos COF no se mandan a Hacienda, así que no tienen sello y no entran al
-- libro de ventas: su lugar natural es junto al aviso de «ventas fuera del
-- libro», que es donde se arma la declaración.
--
-- 1. `get_cof_sin_envio_mh` la puede leer también quien tiene Libros IVA, con
--    el mismo alcance por sucursal que el resto de esa vista.
-- 2. `get_ventas_fuera_del_libro`: `sin_sello` decía «se resuelven en Pendiente
--    MH», y esos COF ya no están ahí. Se cuentan aparte en `cof_noche` para que
--    el aviso no mande a buscar a una cola donde no aparecen. `documentos` y
--    `monto` siguen incluyéndolos: también están fuera del libro.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_cof_sin_envio_mh(
  p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL, p_detalle boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v json;
  v_fact boolean := (SELECT public.auth_has_module_permission('facturacion','can_view'));
  v_libro boolean := (SELECT public.auth_has_module_permission('libros_iva','can_view'));
  v_sucursal bigint := NULL;
BEGIN
  IF NOT (v_fact OR v_libro) THEN
    RAISE EXCEPTION 'FORBIDDEN: sin permiso para ver Facturación ni Libros IVA';
  END IF;
  -- Sólo con Libros IVA y alcance de sala: ve su sala y nada más.
  IF NOT v_fact AND (SELECT public.auth_module_scope('libros_iva')) IS DISTINCT FROM 'ALL' THEN
    v_sucursal := (SELECT public.auth_employee_branch_id());
  END IF;

  WITH docs AS (
    SELECT si.id, si.branch_id, b.name AS sucursal, si.fecha, si.hora, si.correlativo,
           si.cliente, si.subtotal, si.iva, si.total,
           length(si.recibido_mh) = 40 AS con_sello
      FROM public.sales_invoices si
      JOIN public.branches b ON b.id = si.branch_id
     WHERE si.tipo_documento = 'COF'
       AND si.fecha BETWEEN greatest(p_desde, DATE '2026-10-19') AND p_hasta
       AND si.hora >= TIME '18:00'
       AND public.cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora)
       AND public.venta_valida(si.estado)
       AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
       AND (v_sucursal IS NULL OR si.branch_id = v_sucursal)
  )
  SELECT json_build_object(
    'total', (SELECT json_build_object(
                'documentos', count(*),
                'sin_sello',  count(*) FILTER (WHERE NOT coalesce(con_sello, false)),
                'subtotal',   round(coalesce(sum(subtotal), 0), 2),
                'iva',        round(coalesce(sum(iva), 0), 2),
                'monto',      round(coalesce(sum(total), 0), 2)) FROM docs),
    'por_dia', (SELECT coalesce(json_agg(to_json(r) ORDER BY r.fecha DESC, r.sucursal), '[]'::json) FROM (
                  SELECT fecha, branch_id, sucursal,
                         count(*) AS documentos,
                         count(*) FILTER (WHERE NOT coalesce(con_sello, false)) AS sin_sello,
                         round(sum(subtotal), 2) AS subtotal,
                         round(sum(iva), 2) AS iva,
                         round(sum(total), 2) AS monto,
                         min(hora) AS primera, max(hora) AS ultima
                    FROM docs GROUP BY fecha, branch_id, sucursal) r),
    'detalle', CASE WHEN p_detalle THEN
                 (SELECT coalesce(json_agg(to_json(d) ORDER BY d.fecha DESC, d.sucursal, d.hora), '[]'::json) FROM docs d)
               END
  ) INTO v;
  RETURN v;
END;
$function$;

DROP FUNCTION IF EXISTS public.get_ventas_fuera_del_libro(date, date, bigint);
CREATE FUNCTION public.get_ventas_fuera_del_libro(p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(documentos bigint, monto numeric, sin_sello bigint, sello_invalido bigint, cof_noche bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT count(*),
           round(coalesce(sum(si.total), 0)::numeric, 2),
           -- Los motivos van separados porque se resuelven en pantallas
           -- distintas: el sello vacío está en la cola de Hacienda, el inválido
           -- es una anomalía del documento, y el COF de la noche no se manda
           -- por decisión (2026-10-19) y no está en ninguna cola.
           count(*) FILTER (WHERE si.recibido_mh IS NULL
                              AND NOT public.cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora)),
           count(*) FILTER (WHERE si.recibido_mh IS NOT NULL),
           count(*) FILTER (WHERE si.recibido_mh IS NULL
                              AND public.cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora))
    FROM public.sales_invoices si
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND si.tipo_documento IN ('COF', 'CCF')
      AND public.venta_valida(si.estado)
      AND length(coalesce(si.recibido_mh, '')) <> 40
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id);
$function$;

REVOKE EXECUTE ON FUNCTION public.get_ventas_fuera_del_libro(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ventas_fuera_del_libro(date, date, bigint) TO authenticated, service_role;
