-- Muestras de la app de clientes (2026-10-06).
--
-- Ofertas, inyecciones y vencimientos DE MUESTRA amarrados a UNA ficha: sólo
-- esa persona los ve en la app. Existen para revisar el diseño con datos que
-- producción todavía no tiene (cero ofertas publicadas, ninguna inyección
-- pendiente, puntos que vencen en 2027) y, más adelante, para la cuenta de
-- revisión de Apple.
--
-- Por qué una tabla aparte y no filas falsas en las tablas de verdad:
--   · una oferta de muestra en `ofertas_clientes` aparecería en el portal y se
--     le mostraría a TODOS los clientes;
--   · una inyección de muestra en `inyeccion_aplicaciones` necesita un cobro, y
--     entraría a la caja, a los cortes y al tablero de inyecciones.
-- Acá no la lee nada más que `app-clientes`, con la llave del servidor. El
-- portal no tiene policy que la deje ver (la de SELECT es `false` a propósito).
--
-- Borrarlas: DELETE FROM app_cliente_muestras WHERE customer_id = <id>;
SET lock_timeout = '5s';

CREATE TABLE public.app_cliente_muestras (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id  bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    tipo         text NOT NULL CHECK (tipo IN ('oferta', 'inyeccion', 'vencimiento')),
    datos        jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_cliente_muestras_customer_idx ON public.app_cliente_muestras (customer_id, tipo);

ALTER TABLE public.app_cliente_muestras ENABLE ROW LEVEL SECURITY;
-- Explícita y cerrada: el portal NO las ve. Sólo la Edge Function (service_role).
CREATE POLICY app_cliente_muestras_select ON public.app_cliente_muestras
    FOR SELECT TO authenticated USING (false);

REVOKE ALL ON public.app_cliente_muestras FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.app_cliente_muestras TO service_role;
