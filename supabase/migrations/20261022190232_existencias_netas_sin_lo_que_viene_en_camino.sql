SET lock_timeout = '5s';
-- Una reserva que espera un traslado (o un encargo a Bodega) no ocupa existencia
-- de la sala por lo que todavía no llegó: esas unidades vienen con el traslado.
-- Contarlas disparaba «Falta existencia para una reserva» sobre R-000114
-- (2 en camino, 0 en sala) y le restaba disponibles a la app. Lo que ya llegó
-- (traslado_llegaron) sí cuenta, porque ya está en el estante.
CREATE OR REPLACE FUNCTION public.app_existencias_netas(p_ids integer[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN (
    WITH inv AS (
      SELECT DISTINCT ON (i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento,
                          lower(btrim(coalesce(i.presentacion, ''))), lower(coalesce(i.detalle, '')))
             m.branch_id, i.erp_product_id AS product_id, i.cantidad,
             upper(btrim(coalesce(i.presentacion, ''))) AS pres_key, i.detalle
        FROM public.inventory i
        JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id AND NOT m.es_bodega
       WHERE i.erp_product_id = ANY (p_ids) AND NOT coalesce(i.is_vencidos, false)
    ),
    existencia AS (
      SELECT inv.product_id, inv.branch_id,
             sum(inv.cantidad * coalesce(f.factor, nullif(substring(lower(coalesce(inv.detalle, '')) FROM 'x\s*(\d+)'), '')::int, 1)) AS unidades
        FROM inv
        LEFT JOIN public.v_product_factor f ON f.product_id = inv.product_id AND f.pres_key = inv.pres_key
       WHERE inv.cantidad > 0
       GROUP BY 1, 2
    ),
    apartado AS (
      SELECT r.producto_id::int AS product_id, r.branch_id,
             sum(CASE WHEN r.estado = 'pendiente' AND r.traslado_estado IS NOT NULL
                      THEN greatest(0, r.cantidad * r.factor - coalesce(r.traslado_por_llegar, 0))
                      ELSE r.cantidad * r.factor END) AS unidades
        FROM public.app_reservas r
       WHERE r.estado IN ('en_revision', 'pendiente', 'lista') AND r.producto_id = ANY (p_ids::bigint[])
       GROUP BY 1, 2
    )
    SELECT coalesce(json_agg(json_build_object(
             'product_id', coalesce(e.product_id, a.product_id), 'branch_id', coalesce(e.branch_id, a.branch_id),
             'existencia', coalesce(e.unidades, 0), 'apartadas', coalesce(a.unidades, 0),
             'disponibles', greatest(0, coalesce(e.unidades, 0) - coalesce(a.unidades, 0)))), '[]'::json)
      FROM existencia e
      FULL JOIN apartado a ON a.product_id = e.product_id AND a.branch_id = e.branch_id
  );
END;
$function$;
