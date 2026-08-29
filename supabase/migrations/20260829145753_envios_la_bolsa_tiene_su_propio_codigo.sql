SET lock_timeout = '5s';

-- La bolsa del envío tiene su propio número, y por eso puede tener un ticket.
--
-- ── Por qué no alcanzaba el número que ya existe ────────────────────────────
-- Un envío crea UN TRASLADO POR RENGLÓN (decisión del 2026-08-22: la pantalla
-- de recepción del sistema recibe el movimiento completo, así que con N líneas
-- en un solo traslado un producto dañado obligaría a devolver la caja entera).
-- Medido el 2026-08-29 sobre los 25 envíos reales: 46 renglones, 1.84 de
-- promedio, máximo 8 — o sea que la bolsa que alguien carga tiene hasta OCHO
-- números y ninguno la nombra entera.
--
-- La solicitud no tiene ese problema: es un traslado con N líneas, un solo
-- `id_traslado`, y su ticket lleva ése. Por eso el ticket del envío quedó
-- pendiente el 2026-08-24 y hoy se cierra dándole a la bolsa un número propio.
--
-- ── Por qué lleva una letra adelante ───────────────────────────────────────
-- El número del traslado es UNA sola secuencia compartida con los pedidos de
-- Bodega, y `traslado_por_codigo` busca lo escaneado contra las dos. Un número
-- de bolsa hecho de puros dígitos podría COINCIDIR con un traslado real y el
-- escaneo abriría la bolsa equivocada — sin error, con la caja en la mano. La
-- `E` lo vuelve imposible por construcción: `id_traslado` es siempre dígitos.
--
-- CODE128-B gasta `11n + 35` módulos y el rollo de 80 mm imprime sobre 576
-- puntos. A módulo 5 (el del ticket de traslado), `E` + 5 dígitos son 101
-- módulos = 505 puntos. Entra, y sigue entrando cuando la secuencia cruce el
-- 99999 y el código pase a `E` + 6 dígitos (112 módulos = 560 puntos, al filo).
--
-- ── Y por qué lo pone un trigger y no el navegador ─────────────────────────
-- Es la misma regla que `asignar_aprobador_solicitud` y que el `employee_id`
-- del egreso: un número que el cliente manda es un número que el cliente puede
-- repetir, saltear u omitir. Acá además el envío se crea en un `insert` de
-- VARIAS filas —una composición saca producto de varios estantes y cada uno es
-- su propia bolsa—, así que cada fila necesita el suyo sin que nadie las
-- recorra.

CREATE SEQUENCE IF NOT EXISTS public.envio_codigo_bolsa_seq AS bigint START 1;

REVOKE ALL ON SEQUENCE public.envio_codigo_bolsa_seq FROM PUBLIC, anon;
GRANT USAGE ON SEQUENCE public.envio_codigo_bolsa_seq TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.numerar_bolsa_envio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
    -- `||` sobre el metadata vivo y no un objeto nuevo: lo que el navegador
    -- mandó se conserva entero. Y si la clave ya viene puesta NO se pisa —una
    -- reinserción de mantenimiento tiene que poder conservar su número, que es
    -- el que está impreso en un papel que anda dando vueltas.
    IF coalesce(NEW.metadata->>'codigo_bolsa', '') = '' THEN
        NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb)
            || jsonb_build_object(
                'codigo_bolsa',
                'E' || lpad(nextval('public.envio_codigo_bolsa_seq')::text, 5, '0')
            );
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.numerar_bolsa_envio() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_numerar_bolsa_envio ON public.approval_requests;
CREATE TRIGGER trg_numerar_bolsa_envio
    BEFORE INSERT ON public.approval_requests
    FOR EACH ROW
    WHEN (NEW.type = 'INVENTORY_TRANSFER_PUSH')
    EXECUTE FUNCTION public.numerar_bolsa_envio();

-- Los que ya existen, en el orden en que se crearon: así el número más chico es
-- el más viejo, que es lo único que un número correlativo promete. Sin esto,
-- reimprimir el ticket de un envío de la semana pasada no tendría qué imprimir.
WITH numerados AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS n
    FROM public.approval_requests
    WHERE type = 'INVENTORY_TRANSFER_PUSH'
      AND coalesce(metadata->>'codigo_bolsa', '') = ''
)
UPDATE public.approval_requests ar
   SET metadata = coalesce(ar.metadata, '{}'::jsonb)
        || jsonb_build_object('codigo_bolsa', 'E' || lpad(n.n::text, 5, '0'))
  FROM numerados n
 WHERE ar.id = n.id;

-- La secuencia arranca donde terminó el relleno. `setval` con `is_called` en
-- true para que el próximo `nextval` sea el siguiente y no repita el último.
SELECT setval(
    'public.envio_codigo_bolsa_seq',
    greatest(1, (SELECT count(*) FROM public.approval_requests WHERE type = 'INVENTORY_TRANSFER_PUSH')),
    true
);

-- Buscar una bolsa por su código es la operación del escaneo. Hoy la tabla
-- tiene 706 filas y un barrido no se nota; el índice está por lo que va a
-- pasar, no por lo que pasa: `approval_requests` sólo crece y el escaneo es lo
-- que alguien hace con la caja en la mano. Parcial: sólo los envíos tienen la
-- clave.
CREATE INDEX IF NOT EXISTS idx_approval_requests_codigo_bolsa
    ON public.approval_requests ((metadata->>'codigo_bolsa'))
    WHERE type = 'INVENTORY_TRANSFER_PUSH';
