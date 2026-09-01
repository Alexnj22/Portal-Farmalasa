SET lock_timeout = '5s';

-- `registrar_bitacora` devuelve la FILA, no sólo su id.
--
-- Con el id solo, el navegador tenía que armar la fila optimista de su lista
-- local inventando quién firmó y con qué nombre — que es exactamente el defecto
-- que esta función existe para cerrar. Devolviendo la fila, lo que se pinta es
-- lo que quedó escrito.
--
-- Y no abre nada: `audit_logs_select` sigue igual, y lo único que vuelve por acá
-- es la fila que ese mismo llamador acaba de escribir.
DROP FUNCTION IF EXISTS public.registrar_bitacora(text, text, jsonb, text, text, text, text, text, text, text);

CREATE FUNCTION public.registrar_bitacora(
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
) RETURNS json
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
    v_fila     json;
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

    WITH nueva AS (
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
        RETURNING id, user_id, user_name, action, target_id, details,
                  source, severity, branch_id, branch_name, device_name,
                  input_method, created_at
    )
    SELECT to_json(n) INTO v_fila FROM nueva n;

    RETURN v_fila;
END;
$$;

COMMENT ON FUNCTION public.registrar_bitacora(text, text, jsonb, text, text, text, text, text, text, text) IS
'Escribe una fila de audit_logs firmando con auth_employee_id() y devuelve la fila escrita. El llamador NO elige quién firma ni puede perder la fila por un rótulo inválido. Ver src/data/audit.js.';

REVOKE EXECUTE ON FUNCTION public.registrar_bitacora(text, text, jsonb, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_bitacora(text, text, jsonb, text, text, text, text, text, text, text) TO authenticated, service_role;
