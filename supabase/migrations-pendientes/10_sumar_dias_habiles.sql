-- ═══════════════════════════════════════════════════════════════════════════
-- 10 · sumar_dias_habiles(desde, n): la fecha que resulta de sumar n días
-- hábiles (lunes a viernes) a `desde`, sin contar `desde`.
--
-- QUÉ CAMBIA: nada existente. Es el canónico en SQL de `sumarDiasHabiles`
-- (src/data/solicitudesDatos.js) y de la cuenta que ya hace a mano
-- `avisar_solicitudes_datos_por_vencer`: sábado y domingo no cuentan, los
-- asuetos SÍ (sin tabla de asuetos mantenida, descontarlos daría un plazo más
-- largo que el real; contar de menos sólo adelanta el aviso).
--
-- Lo usan las migraciones 20 (plazo de 5 días hábiles de la solicitud de
-- mayorista), 40 (prevención de 10 y aviso a terceros de 5) y 60 (reclamos
-- de 10).
--
-- DESDE CUÁNDO RIGE: es una herramienta, no una regla; no depende de la fecha.
--
-- VERIFICADO en staging (bbfotmyuvmrtmbuqxmhf) con execute_sql:
--   sumar_dias_habiles('2026-10-23' viernes, 1) = 2026-10-26 lunes
--   sumar_dias_habiles('2026-10-24' sábado, 5)  = 2026-10-30 viernes
--   sumar_dias_habiles('2026-11-16' lunes, 10)  = 2026-11-30 lunes
--   sumar_dias_habiles(x, 0) = x
-- y contra `sumarDiasHabiles` del portal en los mismos casos: iguales.
-- ═══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.sumar_dias_habiles(p_desde date, p_n integer)
RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$
  SELECT CASE WHEN p_desde IS NULL OR p_n IS NULL THEN NULL
              WHEN p_n <= 0 THEN p_desde
              ELSE (SELECT x.d::date
                      FROM (SELECT d, row_number() OVER (ORDER BY d) AS k
                              FROM generate_series(p_desde + 1, p_desde + (p_n * 2 + 7), interval '1 day') d
                             WHERE extract(isodow FROM d) < 6) x
                     WHERE x.k = p_n) END;
$$;

REVOKE EXECUTE ON FUNCTION public.sumar_dias_habiles(date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sumar_dias_habiles(date, integer) TO authenticated, service_role;
