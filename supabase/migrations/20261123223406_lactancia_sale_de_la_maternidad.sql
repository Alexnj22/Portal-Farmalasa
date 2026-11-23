-- La lactancia sale de la maternidad (RIT Cap. X, Arts. 59–61).
--
-- No se escribe a mano: se DERIVA de la incapacidad por maternidad
-- (`employee_events` type='DISABILITY', metadata.disabilityType='MATERNIDAD').
-- Talento Humano anota en esa novedad la fecha del parto —la probable
-- (`fechaPartoProbable`, Art. 60) y la real cuando se conozca
-- (`fechaPartoReal`)— y, si hace falta, la da por terminada antes
-- (`lactanciaTerminadaEl`, el último día con lactancia).
--
--   desde = el día siguiente al fin de la maternidad (metadata.endDate;
--           sin él, inicio + 111 = los 112 días del Art. 59)
--   hasta = parto + 6 meses − 1 día (Art. 61: «durante los seis meses
--           posteriores al parto»), con el parto real si existe, si no el
--           probable; recortado por `lactanciaTerminadaEl`.
--   Sin fecha de parto, o con desde > hasta: no hay lactancia.
--
-- Una fecha de la metadata que no sea 'AAAA-MM-DD' (ausente, null, '') vale
-- como ausente: es la verdad de JavaScript, que es quien la escribe.
--
-- Gemelo en JavaScript: `src/utils/lactancia.js` (`periodoDeLactancia`).
-- Los casos de `tests/unit/lactancia.test.js` valen para los dos: cambiar uno
-- exige cambiar el otro y volver a enfrentarlos.
--
-- Sólo crea funciones nuevas: no toca ninguna tabla caliente.
SET lock_timeout = '5s';

-- El juez puro: de una maternidad (su inicio y su metadata) a su período de
-- lactancia. No lee tablas, así que se enfrenta caso por caso con su gemelo
-- sin sembrar filas. Devuelve 0 o 1 fila.
CREATE OR REPLACE FUNCTION public.lactancia_periodo(p_inicio date, p_metadata jsonb)
RETURNS TABLE (desde date, hasta date)
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT f.desde, f.hasta
  FROM (
    SELECT
      coalesce(d.fin, p_inicio + 111) + 1 AS desde,
      CASE WHEN d.parto IS NULL THEN NULL
           ELSE least((d.parto + interval '6 months')::date - 1, d.terminada)
      END AS hasta
    FROM (
      SELECT
        CASE WHEN p_metadata->>'endDate' ~ '^\d{4}-\d{2}-\d{2}'
             THEN left(p_metadata->>'endDate', 10)::date END AS fin,
        coalesce(
          CASE WHEN p_metadata->>'fechaPartoReal' ~ '^\d{4}-\d{2}-\d{2}'
               THEN left(p_metadata->>'fechaPartoReal', 10)::date END,
          CASE WHEN p_metadata->>'fechaPartoProbable' ~ '^\d{4}-\d{2}-\d{2}'
               THEN left(p_metadata->>'fechaPartoProbable', 10)::date END) AS parto,
        CASE WHEN p_metadata->>'lactanciaTerminadaEl' ~ '^\d{4}-\d{2}-\d{2}'
             THEN left(p_metadata->>'lactanciaTerminadaEl', 10)::date END AS terminada
      WHERE p_inicio IS NOT NULL
        AND p_metadata->>'disabilityType' = 'MATERNIDAD'
    ) d
  ) f
  WHERE f.hasta IS NOT NULL AND f.desde <= f.hasta;
$$;

-- El juez con la tabla: la lactancia de esa persona que cubre esa fecha.
-- Devuelve el ÚLTIMO día con lactancia (null = no tiene ese día). INVOKER:
-- el RLS de `employee_events` sigue decidiendo quién ve qué.
-- Las novedades corregidas (SUPERSEDED) o anuladas no cuentan.
CREATE OR REPLACE FUNCTION public.lactancia_hasta(p_employee_id uuid, p_fecha date)
RETURNS date
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT max(p.hasta)
  FROM public.employee_events e
  CROSS JOIN LATERAL public.lactancia_periodo(e.date, e.metadata) p
  WHERE e.employee_id = p_employee_id
    AND e.type = 'DISABILITY'
    AND e.metadata->>'disabilityType' = 'MATERNIDAD'
    AND coalesce(e.metadata->>'status', '') NOT IN ('CANCELLED', 'SUPERSEDED', 'ANULADA')
    AND p_fecha BETWEEN p.desde AND p.hasta;
$$;

-- ¿Tiene lactancia ese día? (Art. 61)
CREATE OR REPLACE FUNCTION public.lactancia_vigente(p_employee_id uuid, p_fecha date)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT public.lactancia_hasta(p_employee_id, p_fecha) IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.lactancia_periodo(date, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.lactancia_hasta(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.lactancia_vigente(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lactancia_periodo(date, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lactancia_hasta(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lactancia_vigente(uuid, date) TO authenticated, service_role;
