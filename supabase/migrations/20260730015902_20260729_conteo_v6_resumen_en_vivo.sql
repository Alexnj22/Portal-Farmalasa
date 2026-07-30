-- Conteo de Inventario — resumen en vivo para las tarjetas del encabezado.
--
-- Los totales de `conteos_inventario` (total_items, total_contados,
-- total_diferencias, valor_faltante/sobrante) los escribe
-- `recalcular_totales_conteo`, que solo corre al FINALIZAR. Mientras el conteo
-- está abierto valen 0, y son justo los días en que a alguien le sirve saber
-- cuánto falta por contar. La vista no tenía de dónde sacarlo: los agregados
-- que ya existían (`get_conteo_products_page`) son de la PÁGINA, o sea de 25
-- productos de 1,500.
--
-- Las dos sumas de dinero usan la MISMA fórmula que
-- `recalcular_totales_conteo` (GREATEST sobre la diferencia × costo) para que la
-- tarjeta en vivo y el número que queda firmado al finalizar no puedan diferir.
-- Si un día cambia una, tiene que cambiar la otra.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_conteo_resumen(p_conteo_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
  -- Mismo predicado que las cinco RPCs de lectura: sin el permiso y con el
  -- conteo abierto, las cifras del sistema no salen de la base. Una tarjeta
  -- "faltante $109,591" arriba de una tabla ciega revelaría de un golpe todo lo
  -- que la tabla está tapando renglón por renglón.
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
BEGIN
  RETURN (
    SELECT to_json(t)
    FROM (
      SELECT
        count(*)::int                                                                  AS total_items,
        count(DISTINCT ci.erp_product_id)::int                                         AS total_productos,
        count(*) FILTER (WHERE ci.estado_item <> 'PENDIENTE')::int                     AS contados,
        count(*) FILTER (WHERE ci.estado_item = 'PENDIENTE')::int                      AS pendientes,
        count(*) FILTER (WHERE ci.estado_item = 'SIN_UBICAR')::int                     AS sin_ubicar,
        count(*) FILTER (WHERE ci.recontado_at IS NOT NULL)::int                       AS recontados,
        count(*) FILTER (WHERE ci.es_agregado_manual)::int                             AS agregados,
        count(DISTINCT ci.contado_por)::int                                            AS contadores,
        CASE WHEN v_ver THEN count(*) FILTER (WHERE ci.diferencia IS NOT NULL AND ci.diferencia <> 0)::int END AS con_diferencia,
        CASE WHEN v_ver THEN COALESCE(SUM(GREATEST(-ci.diferencia, 0) * COALESCE(ci.costo_unitario, 0)), 0) END AS valor_faltante,
        CASE WHEN v_ver THEN COALESCE(SUM(GREATEST( ci.diferencia, 0) * COALESCE(ci.costo_unitario, 0)), 0) END AS valor_sobrante,
        v_ver                                                                          AS ver_sistema
      FROM public.conteo_inventario_items ci
      WHERE ci.conteo_id = p_conteo_id
    ) t
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteo_resumen(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_conteo_resumen(uuid) TO authenticated, service_role;
