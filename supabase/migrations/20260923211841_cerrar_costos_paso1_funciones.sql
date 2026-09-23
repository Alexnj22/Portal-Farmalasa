-- Regla 5 de la Fase 2 (docs/PLAN-CERRAR-AUTORIZACION-2026-08-09.md), paso 1
-- de 3: el costo de los productos sólo con el permiso de verlo.
--
-- Postgres no puede esconder una COLUMNA según quién mira: el RLS es por fila.
-- Así que el camino es (3) quitarle a `authenticated` el SELECT de
-- `product_precios.costo`, y antes (1) que todo lo que hoy lo lee pase a
-- funciones que miran el permiso, y (2) que el catálogo lo pida por ellas.
-- Este paso todavía no cierra la columna: pone a las funciones en condiciones
-- de sobrevivir a ese cierre.
--
-- Medido antes/después en producción (transacción deshecha, 2026-09-23, 7 días):
--   QA y Jefe/a de Compras: 1,727 productos · $51,869.58 · 1,726 con costo, y
--   Sin venta 3,289 · $124,197.54 — idénticos. Jefe/a de Sala: 2,085 filas y
--   $3,003.48, igual que la pantalla (que ya manda la sala propia), costo vacío.
--
--   · `get_precios_con_costo` — lo que el catálogo le pedía a la tabla, con el
--     costo, y sólo con productos_ver_costos o minmax_ver_costos (si no, `[]`).
--   · Las tres funciones de pantalla que leen el costo pasan a DEFINER, con el
--     alcance que antes ponía el RLS escrito adentro, y el costo en NULL para
--     quien no tiene permiso (ver §2). Cambio visible, aprobado como regla 5:
--     las salas dejan de ver Costo/Utilidad/Margen en Ventas → Productos.
--   · `get_no_sales_products` (sin llamador) y `conteo_costo_unitario` (sólo la
--     llaman funciones DEFINER) dejan de ser ejecutables desde el navegador.
--
-- Los cuerpos no se tocan: se renombran a `_base` y se envuelven.

SET lock_timeout = '5s';

-- ── 1 · Lo que el catálogo pedía, con el costo, sólo con el permiso ─────────
CREATE OR REPLACE FUNCTION public.get_precios_con_costo(
    p_product_ids integer[] DEFAULT NULL, p_solo_activos boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF NOT (SELECT public.auth_no_bloqueado())
       OR NOT ((SELECT public.auth_has_module_permission('productos_ver_costos', 'can_view'))
            OR (SELECT public.auth_has_module_permission('minmax_ver_costos', 'can_view'))) THEN
        RETURN '[]'::json;
    END IF;
    RETURN coalesce((
        SELECT json_agg(json_build_object(
                   'product_id', pp.product_id, 'id_presentacion', pp.id_presentacion,
                   'activo', pp.activo, 'descripcion', pp.descripcion, 'factor', pp.factor,
                   'costo', pp.costo,
                   'vineta', pp.vineta, 'descuento_1', pp.descuento_1, 'vip', pp.vip,
                   'clinica', pp.clinica, 'mayoreo', pp.mayoreo, 'premium', pp.premium,
                   'precio_7', pp.precio_7,
                   'presentaciones', json_build_object('tipo', pr.tipo))
               ORDER BY pp.product_id, pp.activo DESC, pp.id_presentacion)
          FROM public.product_precios pp
          LEFT JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
         WHERE (p_product_ids IS NULL OR pp.product_id = ANY (p_product_ids))
           AND (NOT p_solo_activos OR pp.activo)), '[]'::json);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_precios_con_costo(integer[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_precios_con_costo(integer[], boolean) TO authenticated, service_role;

-- ── 2 · Las tres funciones de pantalla que leen el costo ────────────────────
-- Patrón común: el cuerpo de siempre pasa a `_base` (DEFINER, sin acceso desde
-- el navegador) y el nombre de siempre queda como envoltura plpgsql DEFINER
-- que (a) aplica el alcance que antes ponía el RLS y (b) deja el costo en NULL
-- a quien no tiene permiso de verlo —la pantalla ya pinta «—» con NULL—. Sus
-- llamadores SQL (`get_product_sales_agg_jsonb`, `get_product_drill_summary`,
-- `rebuild_product_sales_monthly_agg`, `get_stagnant_inventory_jsonb`,
-- `refresh_product_last_sale`) la siguen llamando por el mismo nombre.
-- Sin JWT (cron) o con service_role se ve todo, igual que antes.
CREATE OR REPLACE FUNCTION public.auth_ve_costos()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(current_setting('request.jwt.claims', true), '') = ''
      OR (SELECT auth.role()) = 'service_role'
      OR ((SELECT public.auth_no_bloqueado())
          AND ((SELECT public.auth_has_module_permission('productos_ver_costos', 'can_view'))
            OR (SELECT public.auth_has_module_permission('minmax_ver_costos', 'can_view'))));
$function$;
REVOKE EXECUTE ON FUNCTION public.auth_ve_costos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_ve_costos() TO authenticated, service_role;

-- 2a · Ventas → Productos. El alcance es el de `sales_invoices_select`, dicho
-- por `alcance_de_ventas()`: una sala con alcance propio ve sólo su sala.
ALTER FUNCTION public.get_product_sales_agg(date, date, integer, text) RENAME TO get_product_sales_agg_base;
ALTER FUNCTION public.get_product_sales_agg_base(date, date, integer, text) SECURITY DEFINER;
REVOKE EXECUTE ON FUNCTION public.get_product_sales_agg_base(date, date, integer, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_product_sales_agg(p_fini date, p_ffin date,
    p_branch_id integer DEFAULT NULL, p_search text DEFAULT NULL)
 RETURNS TABLE(erp_product_id integer, descripcion text, cantidad numeric, neto numeric,
               costo_total numeric, presentaciones jsonb, ultima_venta date,
               ultima_venta_por_suc jsonb, laboratorio_id integer, laboratorio_nombre text,
               oculto_en_ventas boolean, oculto_por_first_names text,
               oculto_por_last_names text, oculto_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_puede boolean; v_sala integer; v_costos boolean;
BEGIN
    SELECT a.puede, a.sala INTO v_puede, v_sala FROM public.alcance_de_ventas() a;
    IF NOT coalesce(v_puede, false) THEN RETURN; END IF;
    IF v_sala IS NOT NULL THEN
        IF p_branch_id IS NOT NULL AND p_branch_id <> v_sala THEN RETURN; END IF;
        p_branch_id := v_sala;
    END IF;
    v_costos := public.auth_ve_costos();
    RETURN QUERY
    SELECT t.erp_product_id, t.descripcion, t.cantidad, t.neto,
           CASE WHEN v_costos THEN t.costo_total END,
           t.presentaciones, t.ultima_venta, t.ultima_venta_por_suc,
           t.laboratorio_id, t.laboratorio_nombre, t.oculto_en_ventas,
           t.oculto_por_first_names, t.oculto_por_last_names, t.oculto_at
      FROM public.get_product_sales_agg_base(p_fini, p_ffin, p_branch_id, p_search) t;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_product_sales_agg(date, date, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_sales_agg(date, date, integer, text) TO authenticated, service_role;

-- 2b · MIN·MAX: el resumen de costo del inventario. `inventory` no tiene corte
-- por sala, así que basta con ver MIN·MAX y tener permiso de costos; sin él,
-- NULL (la pantalla ya no pinta el resumen cuando no llega).
ALTER FUNCTION public.get_inventory_cost_summary(integer) RENAME TO get_inventory_cost_summary_base;
ALTER FUNCTION public.get_inventory_cost_summary_base(integer) SECURITY DEFINER;
REVOKE EXECUTE ON FUNCTION public.get_inventory_cost_summary_base(integer) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_inventory_cost_summary(p_erp_sucursal_id integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF coalesce(current_setting('request.jwt.claims', true), '') <> ''
       AND (SELECT auth.role()) <> 'service_role'
       AND NOT (coalesce((SELECT public.auth_has_module_permission('minmax', 'can_view')), false)
                AND public.auth_ve_costos()) THEN
        RETURN NULL;
    END IF;
    RETURN public.get_inventory_cost_summary_base(p_erp_sucursal_id);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_inventory_cost_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_cost_summary(integer) TO authenticated, service_role;

-- 2c · Gestión de stock → Sin venta. Sin corte por sala (inventario); el costo
-- retenido, sólo con permiso de costos.
ALTER FUNCTION public.get_stagnant_inventory(integer) RENAME TO get_stagnant_inventory_base;
ALTER FUNCTION public.get_stagnant_inventory_base(integer) SECURITY DEFINER;
REVOKE EXECUTE ON FUNCTION public.get_stagnant_inventory_base(integer) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_stagnant_inventory(p_erp_sucursal_id integer DEFAULT NULL)
 RETURNS TABLE(erp_product_id integer, product_name text, laboratorio text, current_stock bigint,
               cost_value numeric, fecha_vencimiento_min date, in_minmax boolean,
               min_qty numeric, max_qty numeric, sold_in jsonb, ultima_venta date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_costos boolean;
BEGIN
    IF coalesce(current_setting('request.jwt.claims', true), '') <> ''
       AND (SELECT auth.role()) <> 'service_role'
       AND NOT (coalesce((SELECT public.auth_no_bloqueado()), false)
                AND (coalesce((SELECT public.auth_has_module_permission('gestion_stock', 'can_view')), false)
                  OR coalesce((SELECT public.auth_has_module_permission('minmax', 'can_view')), false))) THEN
        RETURN;
    END IF;
    v_costos := public.auth_ve_costos();
    RETURN QUERY
    SELECT t.erp_product_id, t.product_name, t.laboratorio, t.current_stock,
           CASE WHEN v_costos THEN t.cost_value END,
           t.fecha_vencimiento_min, t.in_minmax, t.min_qty, t.max_qty, t.sold_in, t.ultima_venta
      FROM public.get_stagnant_inventory_base(p_erp_sucursal_id) t;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_stagnant_inventory(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stagnant_inventory(integer) TO authenticated, service_role;

-- ── 3 · Las dos que el navegador no necesita ────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.get_no_sales_products(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.conteo_costo_unitario(integer, text) FROM PUBLIC, anon, authenticated;
