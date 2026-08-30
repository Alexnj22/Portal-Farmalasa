SET lock_timeout = '5s';

-- ── La consulta pública de puntos, y por qué necesita freno ──────────────────
-- El cliente entra su DUI y su teléfono y ve sus puntos, SIN sesión. Eso hace
-- que sea la primera puerta del portal que se puede tocar desde internet sin
-- credenciales, y cambia el modelo de amenaza: no hay nadie a quien culpar de un
-- intento fallido, así que el único límite posible es el número de intentos.
--
-- Pedir DUI **y** teléfono no es paranoia: con sólo el teléfono, cualquiera que
-- vea un ticket —o que pruebe números— vería el nombre y el saldo de esa
-- persona. Exigir que los dos coincidan en la misma ficha convierte el ataque de
-- «probar números» en «adivinar un par», que es otra cosa.
--
-- El DUI NO se guarda: se guarda su huella. Un registro de intentos que archiva
-- documentos de identidad es, él mismo, una filtración esperando a pasar.
CREATE TABLE IF NOT EXISTS public.puntos_consulta_intentos (
  id          bigserial PRIMARY KEY,
  ip          text        NOT NULL,
  huella_dui  text,
  acerto      boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Parcial y por tiempo: lo único que se consulta es «cuántos fallos hubo recién».
CREATE INDEX IF NOT EXISTS idx_puntos_intentos_ip
  ON public.puntos_consulta_intentos(ip, created_at DESC) WHERE NOT acerto;
CREATE INDEX IF NOT EXISTS idx_puntos_intentos_purga
  ON public.puntos_consulta_intentos(created_at);

ALTER TABLE public.puntos_consulta_intentos ENABLE ROW LEVEL SECURITY;

-- Sin policy de SELECT para nadie: lo escribe y lo lee la función con
-- service_role, que no pasa por RLS. Un registro de intentos de acceso no tiene
-- por qué ser legible desde el navegador de nadie.

COMMENT ON TABLE public.puntos_consulta_intentos IS
  'Intentos de la consulta pública de puntos. Sirve para frenar el ensayo y error; se purga a los 30 días.';


-- ── Contar y anotar en una sola llamada ──────────────────────────────────────
-- Devuelve cuántos fallos lleva esa IP en la ventana ANTES de anotar el intento
-- nuevo. Una función y no dos consultas: entre contar y anotar, un atacante con
-- muchas peticiones a la vez pasaría por el hueco.
CREATE OR REPLACE FUNCTION public.puntos_consulta_registrar(
  p_ip         text,
  p_huella_dui text,
  p_acerto     boolean
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $fn$
DECLARE
  fallos integer;
BEGIN
  SELECT count(*) INTO fallos
  FROM public.puntos_consulta_intentos
  WHERE ip = p_ip AND NOT acerto AND created_at > now() - interval '15 minutes';

  INSERT INTO public.puntos_consulta_intentos (ip, huella_dui, acerto)
  VALUES (p_ip, p_huella_dui, p_acerto);

  RETURN fallos;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_consulta_registrar(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_consulta_registrar(text, text, boolean) TO service_role;


-- ── Encontrar al cliente por DUI + teléfono ──────────────────────────────────
-- Los dos normalizados a dígitos: el portal guarda el DUI como `########-#` y
-- los teléfonos con guiones o espacios según quién los cargó. Comparar el texto
-- crudo haría fallar a la mayoría de la gente que escribe bien sus datos.
--
-- El teléfono se compara por sus últimos 8 dígitos para que dé igual si la ficha
-- lo tiene con el código de país adelante.
--
-- Devuelve UNA sola ficha o ninguna: si el par coincide con dos, no se elige —
-- mostrarle a alguien los puntos de otra persona por un empate es peor que no
-- mostrar nada.
CREATE OR REPLACE FUNCTION public.puntos_cliente_por_dui_y_telefono(
  p_dui      text,
  p_telefono text
) RETURNS TABLE (id bigint, name text, dui text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
  WITH d AS (SELECT regexp_replace(coalesce(p_dui,''), '\D', '', 'g') v),
       t AS (SELECT right(regexp_replace(coalesce(p_telefono,''), '\D', '', 'g'), 8) v),
  candidatos AS (
    SELECT c.id, c.name, c.dui
    FROM public.customers c, d, t
    WHERE length(d.v) = 9 AND length(t.v) = 8
      AND regexp_replace(coalesce(c.dui,''), '\D', '', 'g') = d.v
      AND (right(regexp_replace(coalesce(c.phone,''),     '\D', '', 'g'), 8) = t.v
        OR right(regexp_replace(coalesce(c.telefono2,''), '\D', '', 'g'), 8) = t.v)
  )
  SELECT id, name, dui FROM candidatos
  WHERE (SELECT count(*) FROM candidatos) = 1;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_cliente_por_dui_y_telefono(text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_cliente_por_dui_y_telefono(text, text) TO service_role;
