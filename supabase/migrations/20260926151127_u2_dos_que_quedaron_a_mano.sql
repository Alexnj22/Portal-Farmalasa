-- U2 paso 3 — dos que quedaron con el filtro a mano.
--
-- · `puntos_panel_serie`: la migración 20260926150848 la cambió, y 38 segundos
--   después `puntos_pestana_resumen` (otra sesión, trabajo de puntos) la
--   volvió a crear desde su propia copia, que todavía tenía `si.estado =
--   'FINALIZADA'`. No fue un error de ninguna de las dos: es exactamente la
--   deriva que U2 cierra, y por eso desde ahora el pre-commit rechaza una
--   migración nueva que escriba el filtro a mano (`scripts/migration-gate.mjs`).
-- · `avisar_cambios_que_no_se_quedaron`: escribía el mismo filtro con otra
--   forma —`upper(coalesce(si.estado, '')) NOT IN (…)`— que el censo por
--   patrón no veía. Pregunta si la venta sigue siendo venta, así que va con
--   `venta_valida`. (Con un estado nulo antes contaba y ahora no; hoy no hay
--   ninguno.)
--
-- Mismo método que el paso 2: se reescribe la definición viva y se aborta si
-- el número de cambios no es el esperado.

SET lock_timeout = '5s';

DO $u2$
DECLARE
    f        record;
    d        text;
    hechos   integer;
BEGIN
    FOR f IN SELECT * FROM (VALUES
    ('public.puntos_panel_serie(integer)', 1),
    ('public.avisar_cambios_que_no_se_quedaron(integer)', 1)
    ) v(firma, esperado)
    LOOP
        d := pg_get_functiondef(f.firma::regprocedure);
        d := replace(d, $$upper(coalesce(si.estado, '')) NOT IN ('NULA', 'DTE INVALIDADO EN MH')$$,
                        'public.venta_valida(si.estado)');
        d := regexp_replace(d,
            $$(?<![\w.'])(?<![Ss][Ee][Tt] )((?:\w+\.)?estado)\s*=\s*'FINALIZADA'$$,
            'public.venta_valida(\1)', 'g');
        hechos := (length(d) - length(replace(d, 'public.venta_', ''))) / length('public.venta_');
        IF hechos <> f.esperado THEN
            RAISE EXCEPTION 'U2: % reemplazos en %, se esperaban %', hechos, f.firma, f.esperado;
        END IF;
        EXECUTE d;
    END LOOP;
END
$u2$;