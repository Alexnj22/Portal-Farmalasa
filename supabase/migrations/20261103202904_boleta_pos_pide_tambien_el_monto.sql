-- El número del POS Promerica sólo es único DENTRO de su terminal (2026-11-03).
--
-- La regla del 2026-10-28 decía «POS Promerica → basta el número», porque el
-- número es el ID de transacción del aparato. Eso suponía UNA terminal por
-- sala, y no es así: cada sala tiene la suya (Salud 1 60344001, Salud 2
-- 60346001…) y cada una numera por su lado. El 26-oct se anotaron en Salud 1
-- tres comprobantes impresos por la terminal de Salud 2 (001074, 001075 y la
-- 001071); el 03-nov la terminal de Salud 1 llegó a la 001074 —un pago de
-- Claro de $22.75— y el freno la trató como el CAESS de $29.47 del 26-oct.
--
-- Por qué el monto y no la terminal: la terminal sale de la lectura de la
-- foto y la lectura la confunde (0↔8, 1↔4). Medido sobre los 27 pares de
-- boleta POS repetida de la historia: un duplicado real de Salud 2 (boleta
-- 1132, Retiro Token $150) se leyó 60316001 en un papel y 60346001 en el otro
-- — comparando terminales se habría escapado. Y en los 27, TODOS los
-- duplicados verdaderos tienen el mismo monto; el único par con montos
-- distintos (Salud 4, «5»: $19.59 CAESS y $100 MoneyGram) son dos operaciones.
-- O sea que el POS pasa a juzgarse como cualquier otra familia: mismo número
-- y mismo monto.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.caja_misma_operacion_de_boleta(
  a_tipo_codigo text, a_forma_pago text, a_monto numeric,
  b_tipo_codigo text, b_forma_pago text, b_monto numeric)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
           WHEN public.caja_familia_de_boleta(a_tipo_codigo, a_forma_pago) LIKE 'VOUCHER:%'
             OR public.caja_familia_de_boleta(b_tipo_codigo, b_forma_pago) LIKE 'VOUCHER:%' THEN false
           WHEN public.caja_familia_de_boleta(a_tipo_codigo, a_forma_pago)
                <> public.caja_familia_de_boleta(b_tipo_codigo, b_forma_pago) THEN false
           ELSE a_monto IS NULL OR b_monto IS NULL OR round(a_monto, 2) = round(b_monto, 2)
         END;
$function$;
