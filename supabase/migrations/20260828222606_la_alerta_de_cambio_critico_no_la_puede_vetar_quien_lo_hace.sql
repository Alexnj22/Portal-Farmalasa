SET lock_timeout = '5s';

-- La alerta que impedía guardar el sueldo, el cargo y el estado
-- ====================================================================
--
-- `trg_audit_employee_sensitive` escribe una fila de `audit_logs` cada vez que
-- un UPDATE de `employees` cambia `base_salary`, `role_id` o `status`. La
-- función era la ÚNICA de las ocho que escriben en esa tabla que corría con los
-- permisos de quien dispara el trigger (SECURITY INVOKER) — las otras siete son
-- DEFINER.
--
-- El 2026-08-06 la policy de INSERT de `audit_logs` dejó de ser `WITH CHECK
-- (true)` y pasó a exigir `user_id = auth_employee_id()`. La función nunca
-- escribió `user_id`: lo dejaba en NULL. `NULL = <uuid>` no es TRUE, así que
-- desde ese día la fila la rechaza la policy, el error sube por el trigger y
-- **aborta el UPDATE entero** con
--
--     new row violates row-level security policy for table "audit_logs"
--
-- que PostgREST devuelve como 403 y el portal traduce a «No tienes permiso para
-- hacer esto». O sea: Talento Humano —con `staff_list.can_edit`, `scope ALL` y
-- el GRANT por columna sobre `base_salary` en regla— no podía guardarle el
-- sueldo a nadie, ni cambiarle el cargo, ni activarlo o desactivarlo. Nada de
-- eso era un permiso que le faltara: era la bitácora rebotando su propio asiento.
-- Medido el 2026-08-28: tres PATCH a `/rest/v1/employees` con 403 en tres
-- minutos, y el mensaje de Postgres nombrando `audit_logs`, no `employees`.
--
-- Dos cosas se corrigen acá, y la segunda es la que importa a futuro:
--
-- 1 · **La alerta la escribe el sistema, no el usuario.** Pasa a SECURITY
--     DEFINER. Una alerta crítica que el actor puede hacer fallar —basta con no
--     tener permiso de escribir en la bitácora— no es una alerta: es un permiso
--     de veto. Las otras siete funciones que escriben en `audit_logs` ya son
--     DEFINER por este mismo motivo.
--
-- 2 · **Y ahora dice QUIÉN.** Las ocho filas que esta alerta llegó a escribir en
--     su vida tienen `user_id` y `user_name` en NULL (verificado sobre la tabla):
--     un aviso de «modificación crítica» que no nombra a nadie no sirve para
--     auditar nada. Se estampa el empleado que la causó con la MISMA función que
--     usa la policy (`auth_employee_id()`), así que la fila cumple la policy por
--     construcción y no por excepción. `source` sigue siendo 'SYSTEM' —la alerta
--     la levanta el trigger— y el actor va en `user_id`, que es donde se busca.
--
-- Cuando no hay sesión (cron, service_role, una migración), `auth_employee_id()`
-- devuelve NULL y la fila se escribe igual con 'Sistema/Anónimo': es el mismo
-- texto que usa `appendAuditLog` del portal, y ahí sí «no hay persona» es la
-- verdad. Antes de este cambio esos eran los ÚNICOS casos que lograban escribir,
-- porque service_role no pasa por RLS.

CREATE OR REPLACE FUNCTION public.audit_employee_sensitive_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_actor  uuid;
    v_nombre text;
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.base_salary IS DISTINCT FROM OLD.base_salary OR
            NEW.role_id IS DISTINCT FROM OLD.role_id OR NEW.status IS DISTINCT FROM OLD.status) THEN

            v_actor := public.auth_employee_id();
            IF v_actor IS NOT NULL THEN
                SELECT e.name INTO v_nombre FROM public.employees e WHERE e.id = v_actor;
            END IF;

            INSERT INTO public.audit_logs (user_id, user_name, action, target_id, details, source, severity, branch_id)
            VALUES (v_actor, coalesce(v_nombre, 'Sistema/Anónimo'),
                'ALERTA_MODIFICACION_CRITICA', NEW.id::text,
                jsonb_build_object('old_salary',OLD.base_salary,'new_salary',NEW.base_salary,
                    'old_role',OLD.role_id,'new_role',NEW.role_id,'old_status',OLD.status,'new_status',NEW.status),
                'SYSTEM', 'CRITICAL', NEW.branch_id);
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.audit_employee_sensitive_changes() IS
'Levanta ALERTA_MODIFICACION_CRITICA en audit_logs cuando un UPDATE de employees cambia base_salary, role_id o status. SECURITY DEFINER a propósito: si corriera con los permisos de quien dispara el trigger, la policy de INSERT de audit_logs podría rechazar la fila y ABORTAR el UPDATE — que es lo que pasó del 2026-08-06 al 2026-08-28 y dejó a Talento Humano sin poder guardar sueldos, cargos ni estados. Estampa user_id con auth_employee_id(): la misma función que usa la policy.';
