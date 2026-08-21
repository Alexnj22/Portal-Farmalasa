-- Una boleta no se registra dos veces en la misma sala.
--
-- Pedido del usuario el 2026-08-21, junto con el autocompletado de la foto:
-- «se debe validar que sea correcta, que no se repita (lleva numeracion por
-- sucursal)».
--
-- Son DOS piezas y hacen falta las dos:
--
--   · el ÍNDICE ÚNICO es la garantía. Una comprobación que sólo vive en el
--     navegador es una carrera: dos personas registrando la misma boleta al
--     mismo tiempo pasan las dos, porque cada una consultó antes de que la otra
--     escribiera. Acá el segundo INSERT falla, y falla siempre.
--   · la FUNCIÓN es para poder AVISAR. Un índice único da un error de
--     restricción, que no es algo que se le pueda mostrar a nadie: no dice qué
--     boleta era, ni de cuánto, ni quién la registró.
--
-- Qué cuenta como «la misma»: el número SIN los ceros de adelante y sin lo que
-- no sea dígito —`000292` y `292` son la misma boleta, que es la regla que ya
-- usa `mismaBoleta` en la edge function `leer-boleta`—, en la misma sucursal,
-- del mismo tipo de salida y de la misma entidad.
--
-- La ENTIDAD entra en la clave a propósito. La numeración es por sucursal, pero
-- cada remesadora emite su propio correlativo, así que dos redes distintas
-- pueden traer el mismo número el mismo día sin que nadie se haya equivocado.
-- Dejarlas chocar sería recrear el bug que se acaba de arreglar hoy: frenar una
-- operación real por un dato que el papel no garantiza. El caso «mismo número,
-- otra entidad» se AVISA en pantalla y quien registra decide.
--
-- Las ANULADAS quedan fuera: una operación anulada libera su número, que es lo
-- que permite volver a registrarla bien después de un error.

SET lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS bolsas_oper_boleta_unica
  ON public.bolsas_operaciones (
    branch_id,
    tipo,
    upper(btrim(coalesce(entidad, ''))),
    (ltrim(regexp_replace(numero_boleta, '\D', '', 'g'), '0'))
  )
  WHERE numero_boleta IS NOT NULL
    AND anulada_at IS NULL
    AND ltrim(regexp_replace(numero_boleta, '\D', '', 'g'), '0') <> '';

-- Con qué operación choca un número, para poder decirlo con nombre y monto.
--
-- INVOKER —sin SECURITY DEFINER— para que el RLS siga decidiendo: la policy de
-- SELECT ya acota a la sucursal propia salvo alcance ALL, y ésa es exactamente
-- la pregunta que hay que hacer, porque la numeración es por sucursal.
--
-- Devuelve TODAS las coincidencias del número en la sala, incluidas las de otra
-- entidad: quien llama necesita distinguir «es la misma boleta» de «otra red
-- usó el mismo correlativo», y esa diferencia se pierde si la función ya filtra.
CREATE OR REPLACE FUNCTION public.boleta_ya_registrada(
  p_branch_id bigint,
  p_numero_boleta text
) RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT o.folio, o.tipo, o.entidad, o.monto, o.numero_boleta,
           o.registrado_at, o.registrado_por
    FROM public.bolsas_operaciones o
    WHERE o.branch_id = p_branch_id
      AND o.anulada_at IS NULL
      AND o.numero_boleta IS NOT NULL
      AND ltrim(regexp_replace(p_numero_boleta, '\D', '', 'g'), '0') <> ''
      AND ltrim(regexp_replace(o.numero_boleta,  '\D', '', 'g'), '0')
        = ltrim(regexp_replace(p_numero_boleta, '\D', '', 'g'), '0')
    ORDER BY o.registrado_at DESC
    LIMIT 5
  ) t;
$$;

REVOKE EXECUTE ON FUNCTION public.boleta_ya_registrada(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.boleta_ya_registrada(bigint, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.boleta_ya_registrada(bigint, text) IS
  'Con qué operación de la misma sala choca un número de boleta. Compara sin ceros de adelante ni caracteres no numéricos, ignora las anuladas. INVOKER: el RLS acota a la sucursal.';
