SET lock_timeout = '5s';

-- ── Rentabilidad (2026-10-31) ──────────────────────────────────────────────
-- Productos cuya viñeta deja poco margen sobre el costo, o cuyo margen bajó
-- en el período. Unidad (factor 1). El «antes» sale del historial de precios,
-- que guarda el costo desde el 2026-08-13: si no hay foto tan vieja como el
-- período, se usa la más vieja con costo (y `desde` lo dice).
CREATE OR REPLACE FUNCTION public.get_rentabilidad_json(p_dias integer DEFAULT 60)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('productos_ver_costos', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (
    WITH act AS (
      SELECT pp.product_id, pp.id_presentacion, p.nombre, pr.tipo AS presentacion,
             pp.costo::numeric AS costo, pp.vineta::numeric AS vineta
        FROM public.product_precios pp
        JOIN public.products p ON p.id = pp.product_id AND p.activo
        LEFT JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
       WHERE pp.activo AND pp.factor = 1 AND pp.costo > 0 AND pp.vineta > 0
    ), hist AS (
      SELECT h.product_id, h.id_presentacion, h.costo, h.vineta, h.valid_from,
             row_number() OVER (PARTITION BY h.product_id, h.id_presentacion
                                ORDER BY (h.valid_from <= now() - make_interval(days => p_dias)) DESC,
                                         CASE WHEN h.valid_from <= now() - make_interval(days => p_dias)
                                              THEN -extract(epoch FROM h.valid_from) ELSE extract(epoch FROM h.valid_from) END) AS n
        FROM public.product_precios_history h
       WHERE h.costo > 0 AND h.vineta > 0
    ), t AS (
      SELECT a.*, round((a.vineta - a.costo) / a.vineta * 100, 1) AS margen,
             b.costo AS costo_antes, b.vineta AS vineta_antes, b.valid_from AS desde,
             round((b.vineta - b.costo) / b.vineta * 100, 1) AS margen_antes
        FROM act a
        LEFT JOIN hist b ON b.product_id = a.product_id AND b.id_presentacion = a.id_presentacion AND b.n = 1
    )
    SELECT coalesce(json_agg(json_build_object(
             'product_id', product_id, 'id_presentacion', id_presentacion, 'nombre', nombre, 'presentacion', presentacion,
             'costo', costo, 'vineta', vineta, 'margen', margen,
             'costo_antes', costo_antes, 'vineta_antes', vineta_antes, 'margen_antes', margen_antes, 'desde', desde,
             'cambio_costo', CASE WHEN costo_antes > 0 THEN round((costo - costo_antes) / costo_antes * 100, 1) END,
             'sugerida', sug)
           ORDER BY margen), '[]'::json)
      FROM (
        SELECT t.*,
               -- La viñeta que recupera el margen de antes (o 25 % si no hay
               -- historial), nunca menos de 15 %, al múltiplo de 5 centavos de arriba.
               ceil(costo / (1 - greatest(coalesce(margen_antes, 25), 15) / 100) * 20) / 20 AS sug
          FROM t
         WHERE margen < 15 OR (margen_antes IS NOT NULL AND margen_antes - margen >= 5)
      ) x
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.get_rentabilidad_json(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rentabilidad_json(integer) TO authenticated, service_role;
