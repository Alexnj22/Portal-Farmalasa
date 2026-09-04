SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Cambiar la cuenta bancaria no dejaba rastro
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `audit_employee_sensitive_changes` vigilaba TRES columnas: `base_salary`,
-- `role_id` y `status`. Funciona —9 filas, la última del 28-ago— pero se queda
-- corta justo donde más duele: **`account_number` es la cuenta a la que se le
-- deposita el sueldo a una persona**, y cambiarla era invisible. Lo mismo
-- `bank_name`, el `dui` (su identidad) y el `code` (la credencial con la que
-- entra al portal y marca en el kiosco).
--
-- Vigilar el monto del sueldo y no la cuenta donde cae es una elección rara
-- cuando se la mira de frente: mover el número es visible y mover el destino no.
--
-- ── De los cuatro nuevos se anota QUE cambiaron, no a qué ──────────────────
-- La bitácora la leen cuatro personas y vive en una tabla que se consulta desde
-- el portal. Guardar ahí el DUI o el código de carné en claro sería mudar el
-- secreto de una columna protegida a una que no lo está — justo después de
-- haber protegido la primera.
--
-- ⚠️ Esta versión tiene un defecto que corrige `20260904010222`: el `||` sobre
-- un arreglo con un literal sin tipo es AMBIGUO y hace lanzar al trigger, que
-- por ser AFTER UPDATE se lleva puesta la escritura que venía a auditar. Este
-- archivo se conserva porque el registro de producción lo tiene; lo que corre
-- hoy es la corrección.

CREATE OR REPLACE FUNCTION public.audit_employee_sensitive_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_actor   uuid;
    v_nombre  text;
    v_cambios text[] := '{}';
BEGIN
    IF (TG_OP <> 'UPDATE') THEN
        RETURN NEW;
    END IF;

    IF NEW.bank_name      IS DISTINCT FROM OLD.bank_name      THEN v_cambios := v_cambios || 'bank_name'; END IF;
    IF NEW.account_number IS DISTINCT FROM OLD.account_number THEN v_cambios := v_cambios || 'account_number'; END IF;
    IF NEW.dui            IS DISTINCT FROM OLD.dui            THEN v_cambios := v_cambios || 'dui'; END IF;
    IF NEW.code           IS DISTINCT FROM OLD.code           THEN v_cambios := v_cambios || 'code'; END IF;

    IF NEW.base_salary IS DISTINCT FROM OLD.base_salary
       OR NEW.role_id IS DISTINCT FROM OLD.role_id
       OR NEW.status  IS DISTINCT FROM OLD.status
       OR array_length(v_cambios, 1) IS NOT NULL THEN

        v_actor := public.auth_employee_id();
        IF v_actor IS NOT NULL THEN
            SELECT e.name INTO v_nombre FROM public.employees e WHERE e.id = v_actor;
        END IF;

        INSERT INTO public.audit_logs (user_id, user_name, action, target_id, details, source, severity, branch_id)
        VALUES (v_actor, coalesce(v_nombre, 'Sistema/Anónimo'),
            'ALERTA_MODIFICACION_CRITICA', NEW.id::text,
            jsonb_build_object(
                'old_salary', OLD.base_salary, 'new_salary', NEW.base_salary,
                'old_role',   OLD.role_id,     'new_role',   NEW.role_id,
                'old_status', OLD.status,      'new_status', NEW.status,
                'cambios',    to_jsonb(v_cambios)),
            'SYSTEM', 'CRITICAL', NEW.branch_id);
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.audit_employee_sensitive_changes() IS
'Anota en audit_logs todo cambio de sueldo, cargo o estado (con sus valores) y de banco, cuenta, DUI o código de carné (sólo el nombre del campo: la bitácora no puede volverse el escondite del secreto que se acaba de proteger). Los cuatro últimos entraron el 2026-09-03: cambiar la cuenta a la que se le deposita a alguien no dejaba ningún rastro.';
