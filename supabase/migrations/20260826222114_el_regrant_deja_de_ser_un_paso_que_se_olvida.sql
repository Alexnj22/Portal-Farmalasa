-- El permiso por columna se repara solo cuando `employees_safe` cambia.
--
-- ── El problema, medido ─────────────────────────────────────────────────────
--
-- `employees_safe` es `security_invoker = true` y `authenticated` tiene SELECT
-- **por columna** sobre `employees`. Una columna nueva en la vista sin su GRANT
-- hace fallar **toda** lectura de la vista con 403 «permission denied for table
-- employees» —no sólo la de esa columna— y el padrón no carga: se lleva puesto
-- el arranque del portal.
--
-- La reparación existe desde el 2026-08-26 (`regrant_employees_columns()`, que
-- deriva la lista de la propia vista) pero quedó como **paso manual al final de
-- cada migración**. En UN SOLO DÍA se olvidó TRES veces, entre dos sesiones
-- distintas:
--
--   20260826171310  Art. 23        → 8 columnas sin permiso, portal caído
--   20260826210244  expediente     → mismo defecto, la misma sesión otra vez
--   20260826215803  tipo_ficha     → mismo defecto, la otra sesión
--
-- Tres veces no es descuido: es que un paso manual al final de un archivo largo
-- **no es una regla**. No falla, no avisa, y el que agrega la columna no lo lee.
--
-- ── Por qué un event trigger y no un gate ───────────────────────────────────
--
-- Un gate corre al COMMITEAR y el daño ocurre al APLICAR la migración: el
-- portal ya lleva minutos caído cuando el gate se entera. Esto corre dentro de
-- la misma transacción que crea la vista, así que la ventana es cero.
--
-- ── Las tres cosas que lo hacen seguro ──────────────────────────────────────
--
-- 1 · Filtra por OBJETO. Sólo reacciona a `public.employees_safe`; cualquier
--     otra vista del portal no lo despierta.
-- 2 · No recursa. `regrant_employees_columns()` hace REVOKE/GRANT, cuyo tag es
--     'GRANT' y no 'CREATE VIEW', así que no se vuelve a disparar. El filtro
--     por objeto lo garantiza igual.
-- 3 · **Nunca aborta el DDL.** Si la reparación falla, deja un WARNING y deja
--     pasar. Un trigger que puede tumbar cualquier migración de la tabla de
--     empleados sería una cura peor que la enfermedad.
--
-- ── Probado, no supuesto ────────────────────────────────────────────────────
--
-- Se le fabricó la regresión que debe cazar: agregar una columna a `employees`,
-- publicarla en la vista SIN llamar al regrant, y contar cuántas quedan sin
-- permiso. Resultado: **0**. La prueba corrió dentro de una transacción que se
-- abortó a propósito, así que no dejó rastro (verificado: la columna de prueba
-- no existe).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.regrant_al_cambiar_employees_safe()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
        IF r.object_identity = 'public.employees_safe' THEN
            BEGIN
                PERFORM public.regrant_employees_columns();
                RAISE NOTICE 'employees_safe cambió: permisos por columna reaplicados.';
            EXCEPTION WHEN OTHERS THEN
                -- Deja pasar a propósito: ver punto 3 del encabezado.
                RAISE WARNING 'No se pudieron reaplicar los permisos de employees_safe: %', SQLERRM;
            END;
            RETURN;
        END IF;
    END LOOP;
END;
$fn$;

DROP EVENT TRIGGER IF EXISTS trg_regrant_employees_safe;
CREATE EVENT TRIGGER trg_regrant_employees_safe
    ON ddl_command_end
    WHEN TAG IN ('CREATE VIEW', 'ALTER VIEW')
    EXECUTE FUNCTION public.regrant_al_cambiar_employees_safe();

-- Y se corre una vez ahora, por si algo quedó suelto entre las tres veces.
SELECT public.regrant_employees_columns();
