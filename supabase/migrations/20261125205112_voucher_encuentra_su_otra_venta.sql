-- El voucher encuentra solo su otra venta (2026-11-25, segunda vuelta).
--
-- Pedido del usuario sobre v2.1603.6: «¿por qué escribiría el número de la
-- venta? ¿no puede enlazar ya la venta y la inyección pagada con tarjeta? …
-- no podría enlazar ese mismo voucher a las 2 cosas? así evitamos y
-- ahorramos». Escribir el número queda como último recurso.
--
-- Con `p_monto`: las ventas de la sucursal de hoy o ayer, válidas, cuyo total
-- LIBRE (total menos lo que otros vouchers ya le atribuyeron) es exactamente
-- lo que sobra del voucher. Las de tarjeta primero, la más reciente arriba.
-- Con `p_id`: esa venta sola, sin mirar el monto — es la comprobación de
-- `creditos-erp` antes de cobrar (allí se valida que le alcanza).
--
-- Lo llama `creditos-erp` con la llave de servicio, que ya decidió permiso y
-- sucursal: no se expone a `authenticated`.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.ventas_para_completar_voucher(
  p_branch_id bigint, p_monto numeric, p_id bigint DEFAULT NULL)
RETURNS json
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(to_json(v) ORDER BY v.es_tarjeta DESC, v.fecha DESC, v.hora DESC), '[]'::json)
    FROM (
      SELECT si.id, si.correlativo, si.fecha, si.hora, si.total, si.tipo_pago, si.cliente,
             public.venta_valida(si.estado) AS valida,
             (si.tipo_pago = 'tarjeta') AS es_tarjeta,
             c.ya_cubierto,
             round(si.total - c.ya_cubierto, 2) AS libre
        FROM public.sales_invoices si
        CROSS JOIN LATERAL (
          SELECT coalesce(sum(cp.otra_venta_monto), 0) AS ya_cubierto
            FROM public.creditos_pagos cp WHERE cp.otra_venta_id = si.id) c
       WHERE si.branch_id = p_branch_id
         AND si.fecha BETWEEN (now() AT TIME ZONE 'America/El_Salvador')::date - 1
                          AND (now() AT TIME ZONE 'America/El_Salvador')::date
         AND (CASE WHEN p_id IS NOT NULL THEN si.id = p_id
                   ELSE public.venta_valida(si.estado)
                        AND abs((si.total - c.ya_cubierto) - p_monto) < 0.005 END)
       ORDER BY (si.tipo_pago = 'tarjeta') DESC, si.fecha DESC, si.hora DESC
       LIMIT 10
    ) v;
$$;

REVOKE EXECUTE ON FUNCTION public.ventas_para_completar_voucher(bigint, numeric, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ventas_para_completar_voucher(bigint, numeric, bigint) TO service_role;
