-- Un voucher puede pagar un crédito Y otra venta del mismo cobro (2026-11-25).
--
-- Pedido del usuario, con un voucher de tarjeta por más de los $9.35 que debía
-- la clienta: «la diferencia es porque se cobró una aplicación de inyección …
-- no se puede cobrar aparte, se hace un solo cobro». El lector frenaba con
-- MONTO_MAYOR_AL_SALDO y no había salida en el mostrador.
--
-- La salida no es aceptar el sobrante sin dueño: quien cobra dice el NÚMERO de
-- la otra venta, `creditos-erp` comprueba aquí que esa venta existe en la
-- sucursal (hoy o ayer), que es válida y que su total alcanza para lo que sobra
-- (descontando lo que otros vouchers ya le atribuyeron), y el pago guarda esa
-- parte aparte de lo abonado. `monto` sigue siendo lo que se aplicó a créditos;
-- el papel = monto + otra_venta_monto.
--
-- `otra_venta_id` sin FK a propósito: una FK sobre `sales_invoices` (tabla
-- caliente, crons cada minuto) pide lock allí. Es informativo; la comprobación
-- la hace la función.

SET lock_timeout = '5s';

ALTER TABLE public.creditos_pagos
  ADD COLUMN IF NOT EXISTS otra_venta_id bigint,
  ADD COLUMN IF NOT EXISTS otra_venta_documento text,
  ADD COLUMN IF NOT EXISTS otra_venta_monto numeric(12,2);

ALTER TABLE public.creditos_pagos DROP CONSTRAINT IF EXISTS creditos_pagos_otra_venta_completa;
ALTER TABLE public.creditos_pagos ADD CONSTRAINT creditos_pagos_otra_venta_completa CHECK (
  (otra_venta_id IS NULL) = (otra_venta_monto IS NULL)
  AND (otra_venta_monto IS NULL OR otra_venta_monto > 0)
);

CREATE INDEX IF NOT EXISTS idx_creditos_pagos_otra_venta
  ON public.creditos_pagos (otra_venta_id) WHERE otra_venta_id IS NOT NULL;

COMMENT ON COLUMN public.creditos_pagos.otra_venta_monto IS
  'Parte del comprobante que pagó otra venta del mismo cobro (no se abonó a créditos). Papel = monto + otra_venta_monto.';

-- Las ventas de la sucursal con ese número, de hoy o ayer (hora de El Salvador).
-- El número se compara por sus dígitos, contra el correlativo (0000095929_COF)
-- y contra el último tramo del número de control: quien cobra escribe el que
-- ve en el ticket. Devuelve todas las coincidencias; quien llama decide.
CREATE OR REPLACE FUNCTION public.venta_que_completa_un_voucher(p_branch_id bigint, p_numero text)
RETURNS json
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(json_build_object(
           'id', si.id,
           'correlativo', si.correlativo,
           'fecha', si.fecha,
           'total', si.total,
           'tipo_pago', si.tipo_pago,
           'valida', public.venta_valida(si.estado),
           'ya_cubierto', coalesce((SELECT sum(cp.otra_venta_monto)
                                      FROM public.creditos_pagos cp
                                     WHERE cp.otra_venta_id = si.id), 0)
         ) ORDER BY si.fecha DESC, si.hora DESC), '[]'::json)
    FROM public.sales_invoices si
   WHERE si.branch_id = p_branch_id
     AND si.fecha BETWEEN (now() AT TIME ZONE 'America/El_Salvador')::date - 1
                      AND (now() AT TIME ZONE 'America/El_Salvador')::date
     AND nullif(ltrim(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g'), '0'), '') IS NOT NULL
     AND nullif(ltrim(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g'), '0'), '') IN (
           ltrim(split_part(si.correlativo, '_', 1), '0'),
           ltrim(split_part(si.numero_control, '-', 4), '0'));
$$;

REVOKE EXECUTE ON FUNCTION public.venta_que_completa_un_voucher(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venta_que_completa_un_voucher(bigint, text) TO service_role;
