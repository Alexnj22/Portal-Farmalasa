-- Top productos del mes, POR SALA (pedido del usuario, 2026-11-04: «sí, sólo por sala»).
--
-- La función no recibía sucursal: los cargos de sala tienen `dash_top_productos`
-- con alcance BRANCH y veían el top de TODA la red, con montos. Ahora el alcance
-- se resuelve ACÁ, no en el navegador:
--   · alcance ALL  → la sala que pida (`p_branch_id`), o la red si pide NULL;
--   · cualquier otro → SIEMPRE la sala propia, diga lo que diga el parámetro;
--     sin sala propia, nada.
--   · sin sesión (service_role / mediciones) → lo que pida, como antes.
--
-- Pasa de `LANGUAGE sql` + `SET search_path` a plpgsql con `force_custom_plan`:
-- con parámetros, esa combinación nace con plan genérico (trampa 4 de
-- CLAUDE.md) y acá el plan bueno depende del rango de fechas y de la sala.
-- Sigue siendo INVOKER: el RLS de `sales_invoices` sigue decidiendo.
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.get_top_productos_mes(date, date, integer);

CREATE FUNCTION public.get_top_productos_mes(
    p_fini date, p_ffin date, p_limite integer DEFAULT 10, p_branch_id bigint DEFAULT NULL)
RETURNS TABLE(erp_product_id integer, descripcion text, neto numeric)
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $function$
DECLARE
    v_branch bigint;
BEGIN
    IF auth.uid() IS NULL OR (SELECT auth_module_scope('dash_top_productos')) = 'ALL' THEN
        v_branch := p_branch_id;
    ELSE
        v_branch := (SELECT auth_employee_branch_id());
        IF v_branch IS NULL THEN RETURN; END IF;
    END IF;

    RETURN QUERY
    SELECT t.erp_product_id, t.descripcion, t.neto
    FROM (
      SELECT
        sii.erp_product_id         AS erp_product_id,
        MAX(sii.descripcion)::text AS descripcion,
        SUM(CASE WHEN si.tipo_documento = 'CCF'
                 THEN sii.total_linea::numeric
                 ELSE sii.total_linea::numeric / 1.13
            END)                   AS neto
      FROM public.sales_invoice_items sii
      JOIN public.sales_invoices si ON si.id = sii.invoice_id
      WHERE sii.erp_product_id IS NOT NULL
        AND sii.erp_product_id <> 0
        AND public.venta_valida(si.estado)
        AND si.fecha BETWEEN p_fini AND p_ffin
        AND (v_branch IS NULL OR si.branch_id = v_branch)
      GROUP BY sii.erp_product_id
    ) t
    ORDER BY t.neto DESC
    LIMIT GREATEST(COALESCE(p_limite, 10), 1);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_top_productos_mes(date, date, integer, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_top_productos_mes(date, date, integer, bigint) TO authenticated, service_role;

-- «Revisión de tienda (Google Play)» no pide ajustes de inventario ni de
-- Min/Max (usuario, 2026-11-04). Su sala es Salud 1, una sala real.
DELETE FROM public.role_permissions
WHERE role_id = (SELECT id FROM public.roles WHERE name = 'Revisión de tienda (Google Play)')
  AND module_key IN ('dash_inv_movement', 'dash_minmax_req');
