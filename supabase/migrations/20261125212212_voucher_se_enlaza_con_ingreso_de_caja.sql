-- El voucher también se enlaza con un INGRESO de caja (2026-11-25, tercera vuelta).
--
-- Lo que pasó en sala con el primer cobro real (Salud 1, una clienta con crédito
-- de $9.35): la aplicación de la inyección NO se factura, se anota en el portal
-- como ingreso con tarjeta — P8855, $1.00, voucher 003926 por $10.35, detalle
-- «Aplicacion de inyeccion · Fac 95929_COF». La búsqueda sólo miraba ventas,
-- no encontró nada y no se pudo cobrar. El usuario mandó la foto del ticket
-- del ingreso: «mira».
--
-- Ahora la búsqueda devuelve ventas E ingresos (`clase`), y marca
-- `coincide_voucher` cuando el ingreso trae el mismo total del voucher o el
-- mismo número: ése es el enlace seguro y se elige solo.
--
-- `creditos_pagos.otro_movimiento_id`: el ingreso enlazado. Un pago enlaza
-- una venta o un ingreso, nunca los dos; `otra_venta_monto` va con cualquiera.

SET lock_timeout = '5s';

ALTER TABLE public.creditos_pagos
  ADD COLUMN IF NOT EXISTS otro_movimiento_id bigint;

ALTER TABLE public.creditos_pagos DROP CONSTRAINT IF EXISTS creditos_pagos_otra_venta_completa;
ALTER TABLE public.creditos_pagos ADD CONSTRAINT creditos_pagos_otra_venta_completa CHECK (
  CASE WHEN otra_venta_monto IS NULL
       THEN otra_venta_id IS NULL AND otro_movimiento_id IS NULL
       ELSE otra_venta_monto > 0 AND ((otra_venta_id IS NULL) <> (otro_movimiento_id IS NULL)) END
);

CREATE INDEX IF NOT EXISTS idx_creditos_pagos_otro_movimiento
  ON public.creditos_pagos (otro_movimiento_id) WHERE otro_movimiento_id IS NOT NULL;

COMMENT ON COLUMN public.creditos_pagos.otro_movimiento_id IS
  'Ingreso de caja (caja_movimientos_portal) que el mismo comprobante pagó, p. ej. la aplicación de una inyección. Excluyente con otra_venta_id.';

DROP FUNCTION IF EXISTS public.ventas_para_completar_voucher(bigint, numeric, bigint);

-- Con `p_monto`: ventas válidas e ingresos con tarjeta/transferencia vivos, de
-- hoy o ayer en la sucursal, cuyo monto LIBRE es exactamente lo que sobra.
-- Primero los que coinciden con el voucher (mismo total o mismo número).
-- Con `p_id` (y `p_clase`, 'venta' por omisión): ése solo, sin mirar el monto,
-- para que `creditos-erp` lo compruebe antes de cobrar.
CREATE OR REPLACE FUNCTION public.ventas_para_completar_voucher(
  p_branch_id bigint, p_monto numeric, p_id bigint DEFAULT NULL,
  p_clase text DEFAULT NULL, p_total numeric DEFAULT NULL, p_documento text DEFAULT NULL)
RETURNS json
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(to_json(x) ORDER BY x.coincide_voucher DESC, x.es_tarjeta DESC, x.fecha DESC, x.hora DESC), '[]'::json)
    FROM (
      SELECT * FROM (
        SELECT 'venta'::text AS clase, si.id,
               ltrim(split_part(si.correlativo, '_', 1), '0') AS numero,
               si.correlativo AS documento,
               si.cliente AS descripcion,
               si.fecha, si.hora, si.total, si.tipo_pago,
               public.venta_valida(si.estado) AS valida,
               (si.tipo_pago = 'tarjeta') AS es_tarjeta,
               false AS coincide_voucher,
               c.ya_cubierto,
               round(si.total - c.ya_cubierto, 2) AS libre
          FROM public.sales_invoices si
          CROSS JOIN LATERAL (
            SELECT coalesce(sum(cp.otra_venta_monto), 0) AS ya_cubierto
              FROM public.creditos_pagos cp WHERE cp.otra_venta_id = si.id) c
         WHERE coalesce(p_clase, 'venta') = 'venta'
           AND si.branch_id = p_branch_id
           AND si.fecha BETWEEN (now() AT TIME ZONE 'America/El_Salvador')::date - 1
                            AND (now() AT TIME ZONE 'America/El_Salvador')::date
           AND (CASE WHEN p_id IS NOT NULL THEN si.id = p_id
                     ELSE public.venta_valida(si.estado)
                          AND abs((si.total - c.ya_cubierto) - p_monto) < 0.005 END)
        UNION ALL
        SELECT 'movimiento'::text, m.id,
               'P' || m.id,
               'P' || m.id,
               m.concepto,
               m.fecha, (m.registrado_at AT TIME ZONE 'America/El_Salvador')::time,
               m.monto, lower(m.forma_pago),
               (m.anulado_at IS NULL AND m.tipo = 'ENTRADA' AND m.forma_pago IN ('TARJETA', 'TRANSFERENCIA')),
               (m.forma_pago = 'TARJETA'),
               (p_total IS NOT NULL AND abs(coalesce(m.comprobante_total, 0) - p_total) < 0.005)
                 OR (nullif(ltrim(regexp_replace(coalesce(p_documento, ''), '\D', '', 'g'), '0'), '')
                     = nullif(ltrim(regexp_replace(coalesce(m.numero_boleta, ''), '\D', '', 'g'), '0'), '')),
               c.ya_cubierto,
               round(m.monto - c.ya_cubierto, 2)
          FROM public.caja_movimientos_portal m
          CROSS JOIN LATERAL (
            SELECT coalesce(sum(cp.otra_venta_monto), 0) AS ya_cubierto
              FROM public.creditos_pagos cp WHERE cp.otro_movimiento_id = m.id) c
         WHERE (p_clase = 'movimiento' OR (p_clase IS NULL AND p_id IS NULL))
           AND m.branch_id = p_branch_id
           AND m.fecha BETWEEN (now() AT TIME ZONE 'America/El_Salvador')::date - 1
                           AND (now() AT TIME ZONE 'America/El_Salvador')::date
           AND (CASE WHEN p_id IS NOT NULL THEN m.id = p_id
                     ELSE m.anulado_at IS NULL AND m.tipo = 'ENTRADA'
                          AND m.forma_pago IN ('TARJETA', 'TRANSFERENCIA')
                          AND abs((m.monto - c.ya_cubierto) - p_monto) < 0.005 END)
      ) u
      ORDER BY u.coincide_voucher DESC, u.es_tarjeta DESC, u.fecha DESC, u.hora DESC
      LIMIT 10
    ) x;
$$;

REVOKE EXECUTE ON FUNCTION public.ventas_para_completar_voucher(bigint, numeric, bigint, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ventas_para_completar_voucher(bigint, numeric, bigint, text, numeric, text) TO service_role;
