-- Personal dejó de abrir: 403 «permission denied for table employees».
--
-- `employees_safe` es `security_invoker=true`, o sea que leerla exige que la
-- SESIÓN pueda leer cada columna que la vista nombra. Y desde el 2026-08-16
-- `authenticated` no tiene SELECT sobre la tabla: tiene SELECT **por columna**,
-- otorgado por `regrant_employees_columns()`.
--
-- La migración del Art. 23 (20260826171310) agregó seis columnas y publicó
-- cuatro en la vista. Ninguna recibió su GRANT, así que la vista pasó a nombrar
-- columnas que nadie puede leer y **toda** lectura de `employees_safe` empezó a
-- fallar — no sólo la de esos cuatro campos. Se lleva puesto el arranque entero
-- del portal, porque el padrón sale de ahí.
--
-- Esa consecuencia estaba escrita en la migración del 16-ago: «al pasar de un
-- GRANT de tabla a uno de columnas, una columna nueva de `employees` NO queda
-- legible hasta que se vuelva a correr `regrant_employees_columns()`. Es a
-- propósito pero se rompe en silencio si nadie lo sabe». Diez días después se
-- rompió, y no en silencio: en un 403 que tapa la vista completa.
--
-- Así que el arreglo no puede ser correr la función y ya. Mientras la lista de
-- columnas se mantenga en DOS lugares —la vista y la función— van a volver a
-- separarse, y el modo de falla es éste.

SET lock_timeout = '5s';

-- ── La lista sale de la vista, que es la que decide qué se publica ──────────
--
-- La función ya no dice «todas menos code y kiosk_pin»: dice «las que publica
-- `employees_safe`». Con eso la vista es la ÚNICA declaración de qué ve una
-- sesión, y el permiso la sigue sola. Agregar una columna a la vista alcanza;
-- no agregarla la deja privada, que es el default correcto.
--
-- Los RPC que sirven lo que la vista NO publica —`get_employee_credenciales`,
-- `get_employee_salarios`, `get_employee_identidad`— son SECURITY DEFINER y
-- corren con los permisos del dueño: no dependen de este GRANT y no se tocan.
--
-- Efecto colateral que es en realidad el punto: nueve columnas dejan de ser
-- legibles con la sesión del usuario —`dui`, `alt_identity_document`,
-- `isss_number`, `afp_number`, `base_salary`, `account_number`, `bank_name` y
-- los dos nuevos de expedición del documento—. Salieron de `employees_safe` el
-- 2026-08-24 por ser lo que son, pero el GRANT de columna seguía puesto: un
-- `.from('employees').select('base_salary,dui')` las devolvía igual. Sacarlas
-- de la vista escondía el chorro, no la llave.
CREATE OR REPLACE FUNCTION public.regrant_employees_columns()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_cols text; v_n integer; v_fuera text;
BEGIN
    SELECT string_agg(quote_ident(t.column_name), ', ' ORDER BY t.ordinal_position),
           count(*)
      INTO v_cols, v_n
      FROM information_schema.columns t
     WHERE t.table_schema = 'public' AND t.table_name = 'employees'
       AND EXISTS (SELECT 1 FROM information_schema.columns v
                    WHERE v.table_schema = 'public' AND v.table_name = 'employees_safe'
                      AND v.column_name = t.column_name);

    IF v_cols IS NULL THEN
        RAISE EXCEPTION 'employees_safe no publica ninguna columna de employees: no se revoca nada';
    END IF;

    SELECT string_agg(t.column_name, ', ' ORDER BY t.ordinal_position)
      INTO v_fuera
      FROM information_schema.columns t
     WHERE t.table_schema = 'public' AND t.table_name = 'employees'
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns v
                        WHERE v.table_schema = 'public' AND v.table_name = 'employees_safe'
                          AND v.column_name = t.column_name);

    EXECUTE 'REVOKE SELECT ON public.employees FROM anon, authenticated';
    EXECUTE format('GRANT SELECT (%s) ON public.employees TO authenticated', v_cols);
    RETURN format('%s columnas legibles (las de employees_safe); quedan fuera: %s',
                  v_n, coalesce(v_fuera, '—'));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.regrant_employees_columns() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.regrant_employees_columns() TO service_role;

SELECT public.regrant_employees_columns();
