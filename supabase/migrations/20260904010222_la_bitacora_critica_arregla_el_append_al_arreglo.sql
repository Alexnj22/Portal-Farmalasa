SET lock_timeout = '5s';

-- Corrección inmediata de `20260904010149_la_bitacora_critica_mira_tambien_…`.
--
-- `v_cambios := v_cambios || 'bank_name'` es AMBIGUO: Postgres lee el literal
-- sin tipo como si fuera otro arreglo y responde `malformed array literal`. El
-- trigger lanzaba, y como es AFTER UPDATE **se llevaba puesta la escritura que
-- venía a auditar** — o sea, guardar la cuenta bancaria de alguien fallaba
-- entero. Es la misma familia que `feedback_un_trigger_de_auditoria_invoker_
-- aborta_la_escritura_que_audita`, por otra causa.
--
-- Se detectó al minuto, probando la escritura de verdad después de aplicar; y no
-- habría llegado a producción si esta migración se hubiera ensayado antes en el
-- branch como las tres anteriores. `array_append` es inequívoco.

CREATE OR REPLACE FUNCTION public.audit_employee_sensitive_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_actor   uuid;
    v_nombre  text;
    v_cambios text[] := ARRAY[]::text[];
BEGIN
    IF (TG_OP <> 'UPDATE') THEN
        RETURN NEW;
    END IF;

    IF NEW.bank_name      IS DISTINCT FROM OLD.bank_name      THEN v_cambios := array_append(v_cambios, 'bank_name'); END IF;
    IF NEW.account_number IS DISTINCT FROM OLD.account_number THEN v_cambios := array_append(v_cambios, 'account_number'); END IF;
    IF NEW.dui            IS DISTINCT FROM OLD.dui            THEN v_cambios := array_append(v_cambios, 'dui'); END IF;
    IF NEW.code           IS DISTINCT FROM OLD.code           THEN v_cambios := array_append(v_cambios, 'code'); END IF;

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
                -- Sólo los NOMBRES de los campos, nunca sus valores: la bitácora
                -- la leen cuatro personas y no puede volverse el escondite del
                -- secreto que se acaba de proteger.
                'cambios',    to_jsonb(v_cambios)),
            'SYSTEM', 'CRITICAL', NEW.branch_id);
    END IF;

    RETURN NEW;
END;
$function$;
