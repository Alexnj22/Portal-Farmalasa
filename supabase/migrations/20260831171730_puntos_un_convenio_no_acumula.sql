SET lock_timeout = '5s';

-- ── Hay fichas que no son una persona que compra ─────────────────────────────
-- MAPFRE es un convenio: la aseguradora paga, el medicamento se lo lleva un
-- asegurado, y la ficha de la venta es la de la empresa. Acumularle puntos a esa
-- ficha es acumularle a nadie — un saldo que crece a nombre de una sociedad que
-- nunca va a presentarse a canjearlo.
--
-- La bandera va acá y no en una lista dentro de la función, por lo mismo que
-- `laboratorios.acumula_puntos`: el día que entre otro convenio, apagarlo tiene
-- que ser marcar una fila. Y se llama IGUAL que aquélla a propósito — es la
-- misma pregunta hecha sobre otra tabla, y dos nombres distintos para una misma
-- idea es cómo se termina con dos reglas distintas.
--
-- El default es `true` — acumula. Una ficha nueva es, mientras nadie diga otra
-- cosa, una persona que compra. El error caro es el otro: dejar de acreditarle
-- a alguien no da ningún error, sólo un saldo más bajo que nadie puede explicar.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS acumula_puntos boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.customers.acumula_puntos IS
  'false = las compras de esta ficha no acumulan puntos. Para convenios y fichas que no son una persona que compra (aseguradoras, empresas).';

UPDATE public.customers SET acumula_puntos = false
WHERE erp_id = '19713';   -- MAPFRE SEGURO EL SALVADOR, S.A. — convenio

-- Por `erp_id` y no por `id`: el número del sistema de origen es el que
-- identifica al cliente de verdad (ver la regla del nombre en CLAUDE.md), y el
-- `id` del portal cambiaría si la ficha se recreara.
