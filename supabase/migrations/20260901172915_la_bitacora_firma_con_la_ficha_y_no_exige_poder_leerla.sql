SET lock_timeout = '5s';

-- La firma de la bitácora sale de la BASE, no del navegador.
--
-- `audit_logs.user_id` es la FICHA (`employees.id`) — lo dice su propia FK
-- `fk_audit_logs_user` y lo exige la policy `audit_logs_insert` desde el
-- 2026-08-10 (`las_policies_resuelven_al_empleado_no_a_la_cuenta`). El cliente
-- mandaba `auth.uid()`, que es la CUENTA: coinciden sólo cuando la persona
-- entra por su puerta vieja. Hoy 46 de las 48 fichas activas tienen además una
-- cuenta enlazada en `employee_auth_accounts` con otro id, así que entrando por
-- ahí el INSERT lo rechaza el RLS — y `appendAuditLog` se traga el error.
--
-- El segundo freno es el `.select()` que supabase-js encadena al insert: un
-- RETURNING necesita pasar `audit_logs_select`, que pide
-- `auditview.can_view`. Lo tienen 4 de 48 personas — y son EXACTAMENTE las 4
-- que firmaron algo desde el 10-ago. O sea que en esta tabla escribir exigía
-- poder leer, que es lo contrario de lo que una bitácora necesita.
--
-- Por eso la escritura pasa a una función DEFINER, igual que `registrar_egreso`
-- (misma lección, aprendida el 2026-08-24 en `export_log` y nunca traída acá):
-- el llamador NO elige quién firma, y el id devuelto no depende de poder leer
-- la tabla.
CREATE OR REPLACE FUNCTION public.registrar_bitacora(
    p_action       text,
    p_target_id    text    DEFAULT NULL,
    p_details      jsonb   DEFAULT '{}'::jsonb,
    p_source       text    DEFAULT 'ADMIN_PANEL',
    p_severity     text    DEFAULT 'INFO',
    p_branch_id    text    DEFAULT NULL,
    p_branch_name  text    DEFAULT NULL,
    p_device_name  text    DEFAULT NULL,
    p_input_method text    DEFAULT NULL,
    p_user_name    text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_emp      uuid;
    v_nombre   text;
    v_source   text;
    v_severity text;
    v_branch   integer;
    v_id       uuid;
BEGIN
    -- Sin acción no hay nada que anotar. Devolver NULL y no lanzar: el que
    -- llama está en medio de una acción del usuario y un fallo de la bitácora
    -- no puede tumbarla.
    p_action := nullif(btrim(coalesce(p_action, '')), '');
    IF p_action IS NULL THEN
        RETURN NULL;
    END IF;

    v_emp := public.auth_employee_id();

    -- El nombre sale de la ficha. El del navegador queda de respaldo para
    -- cuando la ficha no se puede resolver — no al revés: si el llamador
    -- pudiera elegir el nombre, la bitácora diría lo que alguien escribió.
    SELECT e.name INTO v_nombre FROM public.employees e WHERE e.id = v_emp;
    v_nombre := coalesce(v_nombre, nullif(btrim(coalesce(p_user_name, '')), ''), 'Sistema/Anónimo');

    -- Un rótulo fuera de catálogo NO puede costar el registro: se cae al valor
    -- por defecto en vez de violar el CHECK y perder la fila entera.
    v_source   := upper(coalesce(p_source, ''));
    IF v_source NOT IN ('ADMIN_PANEL', 'KIOSK', 'SYSTEM') THEN v_source := 'ADMIN_PANEL'; END IF;
    v_severity := upper(coalesce(p_severity, ''));
    IF v_severity NOT IN ('INFO', 'WARNING', 'CRITICAL') THEN v_severity := 'INFO'; END IF;

    -- `branch_id` tiene FK contra `branches`: una sala que no existe tampoco
    -- puede costar el registro.
    BEGIN
        v_branch := nullif(btrim(coalesce(p_branch_id, '')), '')::integer;
    EXCEPTION WHEN others THEN
        v_branch := NULL;
    END;
    IF v_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = v_branch) THEN
        v_branch := NULL;
    END IF;

    INSERT INTO public.audit_logs (
        user_id, user_name, action, target_id, details,
        source, severity, branch_id, branch_name, device_name, input_method
    ) VALUES (
        v_emp, v_nombre, p_action,
        nullif(btrim(coalesce(p_target_id, '')), ''),
        coalesce(p_details, '{}'::jsonb),
        v_source, v_severity, v_branch,
        nullif(btrim(coalesce(p_branch_name, '')), ''),
        nullif(btrim(coalesce(p_device_name, '')), ''),
        nullif(btrim(coalesce(p_input_method, '')), '')
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.registrar_bitacora(text, text, jsonb, text, text, text, text, text, text, text) IS
'Escribe una fila de audit_logs firmando con auth_employee_id(). El llamador NO elige quién firma ni puede perder la fila por un rótulo inválido. Ver src/data/audit.js.';

REVOKE EXECUTE ON FUNCTION public.registrar_bitacora(text, text, jsonb, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_bitacora(text, text, jsonb, text, text, text, text, text, text, text) TO authenticated, service_role;
