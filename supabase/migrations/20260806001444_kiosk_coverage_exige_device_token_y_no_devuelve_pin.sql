-- Barrido de "identidad por parámetro" (SEGURIDAD-AUTORIZACION-2026-08-04 §1),
-- ejecutado el 2026-08-05. De las 5 funciones DEFINER que reciben identidad,
-- las 5 estaban bien. El hallazgo apareció al ampliar el barrido a la misma
-- forma con la SUCURSAL como parámetro:
--
--   `get_kiosk_coverage_employees(p_branch_id, p_week_start)` es ejecutable por
--   `anon`, **no recibe ni valida device_token**, y devuelve para cada empleado
--   de la sucursal pedida: nombre, código, foto, estado y **`kiosk_pin`**.
--   La llave anon viaja en el bundle del frontend, así que cualquiera podía
--   pedir cualquier `p_branch_id` y bajarse el padrón con sus PIN.
--
-- CLAUDE.md decía que las 5 funciones con anon "validan device_token
-- internamente". Era cierto para 4. Ésta se quedó afuera del rediseño de
-- credenciales del kiosco del 2026-07-29: su hermana `get_kiosk_boot_payload`
-- sí exige el token y ya NO devuelve `kiosk_pin` — a ésta no la tocaron.
--
-- Tres cambios:
--   1. Exige `p_device_id` + `p_device_token` contra `kiosk_devices`, igual que
--      `verify_kiosk_pin` y `get_kiosk_boot_payload`.
--   2. La sucursal sale del dispositivo, no del parámetro. El cliente ya no
--      elige de qué sucursal son los datos.
--   3. Deja de devolver `kiosk_pin`. El kiosco no lo necesita desde que la
--      comparación dejó de ser client-side (useTimeClockEngine.js:735): el PIN
--      real se verifica contra `kiosk_credentials.pin_hash` con bcrypt dentro
--      de `verify_kiosk_pin`.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_kiosk_coverage_employees(
    p_device_id    uuid,
    p_device_token uuid,
    p_week_start   date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_branch_id BIGINT;
BEGIN
    -- El dispositivo es la credencial, y de él sale la sucursal.
    SELECT branch_id INTO v_branch_id
    FROM public.kiosk_devices
    WHERE id = p_device_id
      AND device_token = p_device_token
      AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
      AND revoked_at IS NULL;

    IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
    END IF;

    RETURN (
        SELECT COALESCE(jsonb_agg(emp_data), '[]'::jsonb)
        FROM (
            SELECT jsonb_build_object(
                'id',              e.id,
                'name',            e.name,
                'code',            e.code,
                'photo_url',       e.photo_url,
                'status',          e.status,
                'branch_id',       e.branch_id,
                'role',            COALESCE(r.name, ''),
                'secondary_role',  COALESCE(sr.name, ''),
                'exceptions',      COALESCE(e.exceptions, '[]'::jsonb),
                'active_event_type', (
                    SELECT ee.type
                    FROM   employee_events ee
                    WHERE  ee.employee_id = e.id
                      AND  ee.date::date    <= CURRENT_DATE
                      AND  ee.end_date::date >= CURRENT_DATE
                      AND  ee.type IN ('VACATION','DISABILITY','PERMIT','INDUCTION')
                    ORDER BY ee.created_at DESC
                    LIMIT  1
                ),
                'weekly_roster',
                    -- base home roster (draft or published)
                    COALESCE(
                        (SELECT er.schedule_data
                         FROM   employee_rosters er
                         WHERE  er.employee_id    = e.id
                           AND  er.week_start_date = p_week_start
                         ORDER BY (er.status = 'PUBLISHED') DESC
                         LIMIT  1),
                        '{}'::jsonb
                    )
                    ||
                    -- coverage days override home-roster days for this branch
                    COALESCE(
                        (SELECT jsonb_object_agg(sc2.day_of_week::text, sc2.schedule_data)
                         FROM   schedule_coverage sc2
                         WHERE  sc2.employee_id        = e.id
                           AND  sc2.coverage_branch_id = v_branch_id
                           AND  sc2.week_start_date    = p_week_start),
                        '{}'::jsonb
                    )
            ) AS emp_data
            FROM (
                SELECT DISTINCT employee_id
                FROM   schedule_coverage
                WHERE  coverage_branch_id = v_branch_id
                  AND  week_start_date    = p_week_start
            ) covered
            JOIN employees_safe e ON e.id = covered.employee_id
            LEFT JOIN roles r  ON r.id  = e.role_id
            LEFT JOIN roles sr ON sr.id = e.secondary_role_id
            WHERE UPPER(COALESCE(e.status, 'ACTIVO')) <> 'INACTIVO'
        ) sub
    );
END;
$function$;

COMMENT ON FUNCTION public.get_kiosk_coverage_employees(uuid, uuid, date) IS
    'Empleados que cubren turnos en la sucursal DEL DISPOSITIVO esa semana. anon la ejecuta porque el kiosco es pre-login, pero exige device_token y no devuelve el PIN.';

-- La firma vieja sale de circulación: es la que estaba abierta.
DROP FUNCTION IF EXISTS public.get_kiosk_coverage_employees(bigint, date);

REVOKE ALL ON FUNCTION public.get_kiosk_coverage_employees(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kiosk_coverage_employees(uuid, uuid, date)
    TO anon, authenticated, service_role;
