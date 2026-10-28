SET lock_timeout = '5s';
-- La vía por el nombre, segunda vuelta (2026-10-28): «GENTAMICINA 160MG X 2 ML»
-- y «BIOMIKIN 500MG X 2 ML» son ampollas que no lo dicen. Un envase de hasta
-- 3 ml que no es de uso local es inyectable: las suspensiones orales vienen
-- de 15 ml para arriba. Y «CONJUNTIVAL» es un colirio. Es una PROPUESTA: la
-- vía que cuenta es la que una persona fija en `antibioticos_producto`.
CREATE OR REPLACE FUNCTION public.antibiotico_via_por_nombre(p_nombre text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN upper(coalesce(p_nombre, '')) ~ '(\mAMP\M|AMPOLLA|AMPULA|ÁMPULA|\mVIAL|\mINY|INYECTABLE|TRIPACK|\mI\.?V\.?\M|\mI\.?M\.?\M)' THEN 'inyectable'
    WHEN upper(coalesce(p_nombre, '')) ~ '(CREMA|OVULO|ÓVULO|COLIRIO|CONJUNTIV|OTICO|ÓTICO|OFTALM|UNGUENTO|UNGÜENTO|\mGEL\M|LOCION|LOCIÓN|POMADA|VAGINAL|TOPIC|TÓPIC|\mGOTAS\M|SPRAY)' THEN 'local'
    WHEN upper(coalesce(p_nombre, '')) ~ 'X\s*[0-3](\.[0-9]+)?\s*ML\M' THEN 'inyectable'
    ELSE 'oral'
  END;
$$;
