SET lock_timeout = '5s';

-- ===========================================================================
-- C1 (H13) — el sello de Hacienda en las compras.
--
-- Es la UNICA columna donde el libro del portal pierde contra su origen. La
-- Parte 4 lo midio bajando los dos archivos: de las 5 clases de diferencia del
-- libro de compras, en 4 el portal ya tiene razon —NIT, razon social, comillas,
-- decimales— y en 1 sola le falta el dato. Esta.
--
-- Y el dato YA se estaba descargando: `fastBackfill` baja el CSV del libro
-- (`LIBRO_CSV`) y lee las columnas 3 y 21. El sello es la 22. Estaba a un indice.
--
-- CON VALIDACION, que es la leccion de H19: la columna del origen viene
-- CONTAMINADA. De 331 sellos, 6 no miden 40 — hay un codigo de generacion (36),
-- uno con un espacio adentro (41) y tres con texto pegado a mano
-- (...FFEFGbenicar, ...RVBD C-2274298). Un sello con `benicar` atras no es un
-- sello. Se toma solo si mide exactamente 40 alfanumericos; si no, queda NULL.
-- Copiar un identificador sin medirlo es como no tenerlo.
--
-- Verificado corriendo el backfill sobre el 1-10 de julio: 124 de 138 compras
-- quedaron con sello y CERO sellos invalidos guardados.
-- ===========================================================================

ALTER TABLE public.purchase_receipts
  ADD COLUMN IF NOT EXISTS sello_recibido text;

COMMENT ON COLUMN public.purchase_receipts.sello_recibido IS
  'C1/H13: el sello de recepcion de Hacienda del documento de compra, tomado de la columna 22 del CSV del libro del origen que el sync ya descargaba. Solo se guarda si mide exactamente 40 alfanumericos (H19: 6 de 331 vienen con texto pegado a mano). Es la unica columna donde el libro del portal perdia contra su origen.';

-- Mismo criterio que `nit_sv_valido`: una funcion que dice si la FORMA es
-- valida, para que la regla viva en un solo lugar y no repartida en el sync.
CREATE OR REPLACE FUNCTION public.sello_mh_valido(p_sello text)
 RETURNS boolean
 LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p_sello ~ '^[0-9A-Za-z]{40}$';
$function$;

COMMENT ON FUNCTION public.sello_mh_valido(text) IS
  'El sello de recepcion de Hacienda son exactamente 40 caracteres alfanumericos. H19: la columna del libro del origen trae 6 de 331 contaminados — un codigo de generacion de 36, uno con un espacio adentro, y tres con texto pegado a mano. Un sello con `benicar` atras no es un sello.';

-- El indice es parcial y no unico: dos documentos NO comparten sello, pero
-- todavia no hay ninguno cargado y declarar unicidad sobre una columna vacia es
-- prometer algo que no se verifico. Se usa para cruzar (C2), que es su razon de
-- ser.
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_sello
  ON public.purchase_receipts(sello_recibido)
  WHERE sello_recibido IS NOT NULL;
