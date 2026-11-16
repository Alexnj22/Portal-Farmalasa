-- Preventa (2026-11-16, usuario: «¿dónde se ve el lote? ¿cómo sé qué lote
-- sacar y cuánto tengo de ese lote?»): los lotes de cada producto en la
-- sucursal, en el MISMO orden en que caja los usa al recibir la preventa
-- (GENERICO primero, después el que vence antes; `repartirEnLotesDeVenta` en
-- _shared/preventaCaja.ts). Las unidades de un lote son la suma de sus
-- presentaciones (`cantidad × factor`, el factor de `v_inventario_lotes`).
-- Sin los vencidos. Sólo lectura.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.preventa_lotes(p_branch bigint, p_ids integer[])
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.preventa_puede(public.auth_employee_id(), p_branch, 'can_view') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN '[]'::json; END IF;
  IF cardinality(p_ids) > 60 THEN RAISE EXCEPTION 'Demasiados productos.'; END IF;
  RETURN (
    WITH filas AS (
      SELECT DISTINCT ON (v.erp_product_id, v.lote, v.fecha_vencimiento, upper(btrim(coalesce(v.presentacion, ''))), lower(coalesce(v.detalle, '')))
             v.erp_product_id AS producto_id, v.lote, v.fecha_vencimiento AS vence,
             coalesce(v.cantidad, 0) * coalesce(v.factor, 1) AS unidades
        FROM public.v_inventario_lotes v
        JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = v.erp_sucursal_id AND NOT m.es_bodega
       WHERE m.branch_id = p_branch AND v.erp_product_id = ANY (p_ids) AND NOT coalesce(v.is_vencidos, false)
    ), lotes AS (
      SELECT producto_id, lote, vence, sum(unidades)::int AS unidades
        FROM filas GROUP BY producto_id, lote, vence HAVING sum(unidades) > 0
    )
    SELECT coalesce(json_agg(json_build_object('producto_id', p.producto_id, 'lotes', p.lotes)), '[]'::json)
      FROM (SELECT producto_id,
                   json_agg(json_build_object('lote', lote, 'vence', vence, 'unidades', unidades)
                            ORDER BY (upper(lote) = 'GENERICO') DESC, vence NULLS FIRST, lote) AS lotes
              FROM lotes GROUP BY producto_id) p
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.preventa_lotes(bigint, integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preventa_lotes(bigint, integer[]) TO authenticated, service_role;
