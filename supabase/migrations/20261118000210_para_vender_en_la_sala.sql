-- «Para vender» en el kiosco de caja (pedido del usuario, 2026-11-17: «agrega
-- productos con porcentaje alto de utilidad para venderlos, así como las
-- promociones activas, y productos corto vencimiento»).
--
--   · `utilidad`: lo que deja más margen al precio Público (`descuento_1`, el
--     de la venta sin cliente), entre lo que la sucursal TIENE en existencia y
--     vendió al menos 3 veces en 30 días (que se venda, no un rincón del
--     catálogo). Sin receta ni antibióticos: eso no se empuja por ganancia. El
--     % de margen sólo viaja con `dash_meta_sala_vista_completa`.
--   · `promociones`: los renglones abiertos de promociones activas, vigentes
--     hoy, con el bono del vendedor vigente.
--   · `vence`: lo que vence en 6 meses o menos (el corte por MES de
--     `venceCorto.js` / `notificar_vence_corto`) y todavía no venció, en la
--     existencia de la sucursal, lo más próximo primero.
-- Freno: el de las preventas de la sucursal (`preventa_puede`).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.para_vender_en_la_sala(p_branch_id bigint)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_montos boolean := public.auth_has_module_permission('dash_meta_sala_vista_completa', 'can_view');
  v_suc    smallint;
  v_corte  date;
BEGIN
  IF NOT public.preventa_puede(public.auth_employee_id(), p_branch_id, 'can_view') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT m.erp_sucursal_id INTO v_suc
    FROM public.erp_sucursal_map m WHERE m.branch_id = p_branch_id AND NOT m.es_bodega LIMIT 1;
  -- Hasta el último día del mes de hoy + 6.
  v_corte := (date_trunc('month', v_hoy) + interval '7 months')::date;

  RETURN json_build_object(
    'utilidad', (SELECT coalesce(json_agg(json_build_object('id', id, 'nombre', nombre, 'ventas', n, 'existencia', c,
                                                            'margen', CASE WHEN v_montos THEN margen END) ORDER BY margen DESC), '[]'::json)
                   FROM (SELECT p.id, p.nombre, v.n, st.c,
                                round((pp.descuento_1 - pp.costo) / pp.descuento_1 * 100, 1) AS margen
                           FROM (SELECT it.erp_product_id pid, count(DISTINCT s.id) n
                                   FROM public.sales_invoices s
                                   JOIN public.sales_invoice_items it ON it.invoice_id = s.id
                                  WHERE s.branch_id = p_branch_id AND s.fecha >= v_hoy - 30
                                    AND public.venta_valida(s.estado) AND coalesce(it.erp_product_id, 0) <> 0
                                  GROUP BY 1 HAVING count(DISTINCT s.id) >= 3) v
                           JOIN (SELECT i.erp_product_id pid, sum(i.cantidad) c
                                   FROM public.inventory i
                                  WHERE i.erp_sucursal_id = v_suc AND NOT i.is_vencidos AND i.cantidad > 0
                                  GROUP BY 1) st ON st.pid = v.pid
                           JOIN (SELECT DISTINCT ON (product_id) product_id, costo, descuento_1
                                   FROM public.product_precios
                                  WHERE activo AND costo > 0 AND descuento_1 > 0
                                  ORDER BY product_id, factor) pp ON pp.product_id = v.pid
                           JOIN public.products p ON p.id = v.pid
                          WHERE NOT coalesce(p.requiere_receta, false) AND NOT coalesce(p.es_antibiotico, false)
                          ORDER BY margen DESC
                          LIMIT 6) x),
    'promociones', (SELECT coalesce(json_agg(json_build_object('promocion', promo, 'id', pid, 'nombre', nombre, 'fin', fin,
                                                               'bono', bono, 'unidades_por_bono', upb) ORDER BY fin NULLS LAST, nombre), '[]'::json)
                      FROM (SELECT pr.nombre promo, r.erp_product_id pid, p.nombre, r.fin, t.bono_vendedor bono, t.unidades_por_bono upb
                              FROM public.promocion_renglon r
                              JOIN public.promociones pr ON pr.id = r.promocion_id AND pr.estado = 'activa'
                              JOIN public.products p ON p.id = r.erp_product_id
                              LEFT JOIN LATERAL (SELECT tt.bono_vendedor, tt.unidades_por_bono
                                                   FROM public.promocion_renglon_tarifa tt
                                                  WHERE tt.renglon_id = r.id AND tt.desde <= v_hoy
                                                  ORDER BY tt.desde DESC LIMIT 1) t ON true
                             WHERE r.estado = 'abierto' AND v_hoy BETWEEN r.inicio AND coalesce(r.fin, v_hoy)
                             LIMIT 8) x),
    'vence', (SELECT coalesce(json_agg(json_build_object('nombre', descripcion, 'lote', lote, 'vence', fecha_vencimiento, 'cantidad', cantidad)
                                       ORDER BY fecha_vencimiento, descripcion), '[]'::json)
                FROM (SELECT i.descripcion, i.lote, i.fecha_vencimiento, i.cantidad
                        FROM public.inventory i
                       WHERE i.erp_sucursal_id = v_suc AND NOT i.is_vencidos AND i.cantidad > 0
                         AND i.fecha_vencimiento >= v_hoy AND i.fecha_vencimiento < v_corte
                       ORDER BY i.fecha_vencimiento, i.descripcion
                       LIMIT 8) x),
    'vence_total', (SELECT count(*) FROM public.inventory i
                     WHERE i.erp_sucursal_id = v_suc AND NOT i.is_vencidos AND i.cantidad > 0
                       AND i.fecha_vencimiento >= v_hoy AND i.fecha_vencimiento < v_corte));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.para_vender_en_la_sala(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.para_vender_en_la_sala(bigint) TO authenticated, service_role;
