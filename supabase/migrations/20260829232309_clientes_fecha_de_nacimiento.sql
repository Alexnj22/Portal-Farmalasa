SET lock_timeout = '5s';

-- La ficha del cliente no tenía fecha de nacimiento. En el sistema de puntos hay
-- 11,302 —son las que alimentan las 4,772 cortesías de cumpleaños—, así que se
-- traen de ahí.
--
-- ⚠️ NO se copian las 11,302. El campo allá es `varchar(10)` y tiene basura que
-- sólo se ve mirándola: el rango va de «0001-01-02» a «7957-09-07», y 21 filas
-- están TRUNCADAS por el largo («11974-12-1», «101972-02-»). Se aceptan sólo las
-- que tienen forma de fecha, son una fecha real y caen en un año creíble: 11,203.
-- Copiar las otras habría metido cumpleaños del año 1 y del 7957 en la ficha, y
-- eso no falla nunca — sólo aparece un día en un listado de cumpleaños.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS fecha_nacimiento date;

COMMENT ON COLUMN public.customers.fecha_nacimiento IS
  'Fecha de nacimiento del cliente. Origen: el sistema de puntos (2026-08-29), sólo las que pasaron el filtro de fecha real y año creíble.';

-- ── Escribe por DUI, y sólo cuando el DUI identifica a UNA persona ───────────
-- El puente entre los dos sistemas es el documento normalizado a dígitos: el
-- portal guarda `########-#` y allá los formatos varían. Y se exige que el DUI
-- traiga UNA sola fecha: si el mismo documento viene con dos fechas distintas,
-- no hay forma de saber cuál es y escribir cualquiera sería inventar el
-- cumpleaños de alguien.
--
-- Tampoco pisa una fecha que ya esté puesta: esta carga es para LLENAR el hueco,
-- no para mandar sobre lo que alguien haya escrito después a mano.
CREATE OR REPLACE FUNCTION public.clientes_anotar_nacimiento(p_filas json)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $fn$
DECLARE
  n integer;
BEGIN
  WITH entrada AS (
    SELECT regexp_replace((x->>'dui')::text, '\D', '', 'g') AS dui,
           (x->>'fecha')::date                              AS fecha
    FROM json_array_elements(p_filas) x
  ),
  sin_ambiguedad AS (
    SELECT dui, min(fecha) AS fecha
    FROM entrada
    WHERE length(dui) = 9
    GROUP BY dui
    HAVING count(DISTINCT fecha) = 1
  )
  UPDATE public.customers c
     SET fecha_nacimiento = s.fecha,
         updated_at       = now()
    FROM sin_ambiguedad s
   WHERE regexp_replace(coalesce(c.dui,''), '\D', '', 'g') = s.dui
     AND c.fecha_nacimiento IS NULL;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.clientes_anotar_nacimiento(json) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.clientes_anotar_nacimiento(json) TO service_role;
