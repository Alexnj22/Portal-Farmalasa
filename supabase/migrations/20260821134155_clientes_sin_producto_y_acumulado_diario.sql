SET lock_timeout = '5s';

-- ── Qué venta NO es venta de productos ───────────────────────────────────────
--
-- Bajo los códigos administrativos 100 y 1000 —que no son de ningún vendedor de
-- mostrador: `employees` no tiene a nadie con esos códigos— conviven DOS cosas
-- distintas, y confundirlas es lo que estaba inflando la meta:
--
--   · venta de mostrador de verdad, hecha sin código de vendedor
--     (OZEMPIC $350, LANZOPRAL $87.30, CONCOR/REGUTOL, CIPRO/AMOXI…)
--   · cobros que no son venta de productos: la comisión del corresponsal
--     bancario, el apoyo promocional de un laboratorio, las dietas de reunión
--
-- Los segundos NO se pueden distinguir por su forma: el sistema de origen los
-- factura como si fueran artículos —«COMISIONES POR SERVICIO DE CORRESPONSAL»
-- es el artículo 4239 y tiene su id igual que una caja de ibuprofeno—, así que
-- ninguna columna los delata. Lo que sí los distingue es a QUIÉN se le cobran:
-- a un banco, a un laboratorio, a la cooperativa. De ahí esta lista.
--
-- Medido en producción el 2026-08-20 sobre toda la historia (may-2025 →
-- ago-2026): las 31 facturas de estas tres fichas están TODAS bajo el código
-- 1000, y las ~73 facturas restantes de los códigos 100/1000 son todas venta de
-- mostrador a personas. O sea que hoy la regla «código administrativo + ficha
-- de la lista» y la regla «ficha de la lista» seleccionan exactamente lo mismo.
-- Se exige igual el código administrativo porque es la condición conservadora:
-- el día que a Banco Promerica se le venda un medicamento de verdad, esa venta
-- va a llevar el código de quien la hizo y va a contar, que es lo correcto.
CREATE TABLE IF NOT EXISTS public.clientes_sin_producto (
    customer_id bigint      PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
    motivo      text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid
);

COMMENT ON TABLE public.clientes_sin_producto IS
    'Fichas a las que se les cobra algo que no es venta de productos (comisiones, apoyo promocional, dietas). Sus facturas bajo los códigos administrativos 100/1000 no cuentan para la meta.';

ALTER TABLE public.clientes_sin_producto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bloqueo_global ON public.clientes_sin_producto;
CREATE POLICY bloqueo_global ON public.clientes_sin_producto
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.auth_no_bloqueado()));

DROP POLICY IF EXISTS clientes_sin_producto_select ON public.clientes_sin_producto;
CREATE POLICY clientes_sin_producto_select ON public.clientes_sin_producto
    FOR SELECT TO authenticated USING (true);

-- Quien puede editar Ventas puede declarar una ficha. No `USING (true)`.
DROP POLICY IF EXISTS clientes_sin_producto_insert ON public.clientes_sin_producto;
CREATE POLICY clientes_sin_producto_insert ON public.clientes_sin_producto
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['ventas'])));

DROP POLICY IF EXISTS clientes_sin_producto_delete ON public.clientes_sin_producto;
CREATE POLICY clientes_sin_producto_delete ON public.clientes_sin_producto
    FOR DELETE TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['ventas'])));

-- Las tres medidas. Se resuelven por `erp_id` —el número del sistema de
-- origen— y NO por el nombre: el nombre sale de cómo se escribió la factura y
-- cambia. Si alguna no está, no se inserta y no se rompe la migración.
INSERT INTO public.clientes_sin_producto (customer_id, motivo)
SELECT c.id, v.motivo
FROM (VALUES
    ('9743',  'Comisión por servicio de corresponsal bancario'),
    ('13700', 'Apoyo promocional de laboratorio'),
    ('20935', 'Dietas de reuniones de la cooperativa')
) AS v(erp_id, motivo)
JOIN public.customers c ON c.erp_id = v.erp_id
ON CONFLICT (customer_id) DO NOTHING;

-- ── El acumulado diario lleva su propio renglón ──────────────────────────────
-- `sum_total` sigue siendo la venta ENTERA del día —es lo que ve Ventas, lo que
-- cuadra contra el corte y lo que exige el libro—; `sum_no_producto` es la
-- parte de ese total que no es venta de productos. La meta usa la resta.
--
-- Se guarda la parte y no el neto a propósito: con el neto guardado no habría
-- forma de que una pantalla avise «de este total, $X no son productos», que es
-- justo lo que se pide del otro lado.
ALTER TABLE public.sales_daily_stats
    ADD COLUMN IF NOT EXISTS sum_no_producto numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.sales_daily_stats.sum_no_producto IS
    'Parte de sum_total que NO es venta de productos (ver clientes_sin_producto). La meta resta esto; Ventas y el libro no.';
