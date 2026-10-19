-- Los COF de la noche son información de admin, no de contabilidad (2026-10-19).
--
-- Pedido del usuario: «la evidencia no la tiene que ver el contador por ahora,
-- solo admin» y, sobre el aviso de Libros IVA, «no debería [decirlo], ya que
-- esto es oculto».
--
-- 1. `get_cof_sin_envio_mh` sólo contesta a los cuatro cargos que el usuario
--    llama «admin», por id (un rótulo no es una clave): 2 Gerente General,
--    3 Administrador, 11 Jefe/a de Talento Humano, 13 Supervisor/a de Ventas —
--    los mismos de `CARGOS_DEL_AREA_ADMINISTRATIVA` en el frente. Cargo propio
--    o secundario. El permiso de Facturación o Libros IVA ya no alcanza.
-- 2. `get_ventas_fuera_del_libro` deja de contarlos: ni en `documentos`, ni en
--    `monto`, ni en `sin_sello`. Vuelve a su forma de cuatro columnas — la
--    `cof_noche` del cambio anterior era justamente la mención que no va.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_cof_sin_envio_mh(
  p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL, p_detalle boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v json;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employees e
     WHERE e.id = (SELECT public.auth_employee_id())
       AND e.status = 'ACTIVO'
       AND (e.role_id IN (2, 3, 11, 13) OR e.secondary_role_id IN (2, 3, 11, 13))
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: sólo para el área administrativa';
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
 RETURNS TABLE(documentos bigint, monto numeric, sin_sello bigint, sello_invalido bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT count(*),
           round(coalesce(sum(si.total), 0)::numeric, 2),
           -- Los dos motivos van separados porque se resuelven en pantallas
           -- distintas: el sello vacío está en la cola de Hacienda, el inválido
           -- es una anomalía del documento.
           count(*) FILTER (WHERE si.recibido_mh IS NULL),
           count(*) FILTER (WHERE si.recibido_mh IS NOT NULL)
    FROM public.sales_invoices si
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND si.tipo_documento IN ('COF', 'CCF')
      AND public.venta_valida(si.estado)
      AND length(coalesce(si.recibido_mh, '')) <> 40
      -- Los COF de la noche no se envían por decisión y no se nombran en
      -- contabilidad (2026-10-19): su evidencia es de admin.
      AND NOT public.cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora)
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id);
$function$;

REVOKE EXECUTE ON FUNCTION public.get_ventas_fuera_del_libro(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ventas_fuera_del_libro(date, date, bigint) TO authenticated, service_role;
