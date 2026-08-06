-- Un rechazo de Hacienda NO llega como array.
--
-- `enviarDteAlMH` (supabase/functions/_shared/erp-dte.ts) lanza cuando no hay
-- sello, y las observaciones quedan concatenadas dentro del mensaje de error:
--
--   "Hacienda rechazó el documento: [receptor.direccion.distrito] VALOR NO ES
--    PERMITIDO — [identificacion.fecEmi] DIFIERE DE LA FECHA DE ENVIO"
--
-- O sea que justo el caso ACCIONABLE —el que se arregla corrigiendo la ficha
-- del cliente— entra por la vía que pierde la estructura, mientras que las que
-- sí llegan como array son casi todas `fecEmi`, que NO se arregla (aparece al
-- transmitir hoy una factura emitida antes; "corregirla" sería alterar un dato
-- fiscal).
--
-- Medido sobre el histórico ya cargado: la única observación accionable vista
-- —`receptor.direccion.distrito`, 3 veces en 2 facturas— aparecía las 3 en
-- rechazos, o sea invisible para el clasificador anclado al inicio del texto.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.extraer_observaciones_mh(p_texto text)
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $fn$
  -- Cada "[ruta] mensaje" hasta el próximo corchete. El btrim saca el
  -- separador que queda pegado cuando venían varias concatenadas.
  -- Devuelve '{}' y nunca NULL: un array nulo se propaga y hace desaparecer
  -- la fila de cualquier unnest.
  SELECT coalesce(
    (SELECT array_agg(btrim(m[1], ' .,;—-–'))
       FROM regexp_matches(coalesce(p_texto, ''), '(\[[^\]]+\][^\[]*)', 'g') m),
    '{}');
$fn$;

REVOKE EXECUTE ON FUNCTION public.extraer_observaciones_mh(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.extraer_observaciones_mh(text) TO authenticated, service_role;

-- El clasificador ya no ancla al inicio (`^\[` → `\[`): la ruta puede venir
-- precedida del "Hacienda rechazó el documento: " del mensaje de error.
CREATE OR REPLACE FUNCTION public.clasificar_observacion_mh(p_texto text)
RETURNS TABLE (familia text, ruta text, campo_ficha text, accionable boolean)
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $fn$
  WITH x AS (
    SELECT substring(p_texto from '\[([^\]]+)\]') AS r
  )
  SELECT
    CASE
      WHEN x.r LIKE 'receptor.%'       THEN 'receptor'
      WHEN x.r LIKE 'identificacion.%' THEN 'documento'
      WHEN x.r LIKE 'emisor.%'         THEN 'emisor'
      WHEN x.r IS NULL                 THEN 'desconocida'
      ELSE 'otra'
    END,
    x.r,
    CASE x.r
      WHEN 'receptor.direccion.distrito'     THEN 'distrito'
      WHEN 'receptor.direccion.municipio'    THEN 'municipio'
      WHEN 'receptor.direccion.departamento' THEN 'departamento'
      WHEN 'receptor.direccion.complemento'  THEN 'direccion'
      WHEN 'receptor.telefono'               THEN 'phone'
      WHEN 'receptor.correo'                 THEN 'email'
      WHEN 'receptor.nombre'                 THEN 'name'
      WHEN 'receptor.nrc'                    THEN 'nrc'
      WHEN 'receptor.nit'                    THEN 'nit'
      WHEN 'receptor.numDocumento'           THEN 'dui'
      WHEN 'receptor.descActividad'          THEN 'giro'
      WHEN 'receptor.codActividad'           THEN 'giro'
      ELSE NULL
    END,
    coalesce(x.r LIKE 'receptor.%' AND x.r IN (
        'receptor.direccion.distrito', 'receptor.direccion.municipio',
        'receptor.direccion.departamento', 'receptor.direccion.complemento',
        'receptor.telefono', 'receptor.correo', 'receptor.nombre',
        'receptor.nrc', 'receptor.nit', 'receptor.numDocumento',
        'receptor.descActividad', 'receptor.codActividad'), false)
  FROM x;
$fn$;

REVOKE EXECUTE ON FUNCTION public.clasificar_observacion_mh(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.clasificar_observacion_mh(text) TO authenticated, service_role;

-- Rellenar el histórico: las filas cuyo rechazo traía rutas dentro del texto
-- se quedaron con `observaciones` vacío.
UPDATE public.dte_mh_intentos
   SET observaciones = public.extraer_observaciones_mh(error)
 WHERE error IS NOT NULL
   AND cardinality(observaciones) = 0
   AND cardinality(public.extraer_observaciones_mh(error)) > 0;
