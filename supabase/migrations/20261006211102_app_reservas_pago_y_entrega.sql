SET lock_timeout = '5s';

-- Cómo se paga y cómo se entrega una reserva (2026-10-06, pedido del usuario:
-- «si fue pagado, pendiente de pago, tipo de pago, retiro y a dónde,
-- domicilio»). Hoy toda reserva de la app se retira en sucursal y se paga al
-- retirar; las columnas existen ya para el pago en línea (Wompi), el anticipo
-- en sucursal y la entrega a domicilio, y la app las muestra tal cual.
ALTER TABLE public.app_reservas
    ADD COLUMN pago_estado text NOT NULL DEFAULT 'pendiente'
        CHECK (pago_estado IN ('pendiente', 'anticipo', 'pagado', 'devuelto')),
    ADD COLUMN pago_metodo text NOT NULL DEFAULT 'al_retirar'
        CHECK (pago_metodo IN ('al_retirar', 'efectivo', 'tarjeta', 'en_linea', 'transferencia')),
    ADD COLUMN pagado_at timestamptz,
    ADD COLUMN entrega text NOT NULL DEFAULT 'retiro' CHECK (entrega IN ('retiro', 'domicilio')),
    ADD COLUMN direccion_entrega text CHECK (direccion_entrega IS NULL OR length(direccion_entrega) <= 300),
    ADD CONSTRAINT app_reservas_domicilio_con_direccion CHECK (entrega <> 'domicilio' OR direccion_entrega IS NOT NULL);
