-- 20260729_kiosk_credentials_store
--
-- Fase 1 del rediseño de credenciales del kiosco (AUDITORIA-SUPABASE-2026-07-29.md,
-- S1-bis). ADITIVA: no cambia ningún comportamiento actual. El kiosco sigue
-- funcionando exactamente igual hasta que el frontend haga el cutover.
--
-- Problema: hoy `employees.kiosk_pin` guarda el PIN EN CLARO, legible por
-- cualquier usuario autenticado vía `?select=kiosk_pin`, y además se reparte al
-- rol `anon` dentro de get_kiosk_boot_payload. El PIN se deriva del código del
-- empleado sin secreto (SHA-256(code)), así que no es una credencial.
--
-- Decisiones tomadas con el usuario:
--   · PIN aleatorio, guardado solo como hash, mostrado UNA vez.
--   · Identidad = carné escaneado; el PIN solo confirma → 1 sola comparación
--     bcrypt (~80 ms) en lugar de probar contra los ~50 de la sucursal.
--   · El PIN se pide solo en los 6 casos `requiresAuth` de
--     src/utils/timeClock.helpers.js (excepciones que afectan planilla).
--
-- Por qué tabla aparte y no una columna en `employees`:
--   · `data/system.js:37` hace `select('*')` sobre employees; un GRANT por
--     columna lo rompería entero.
--   · Mantiene el hash fuera de `employees_safe` a propósito — excepción
--     deliberada a la regla de paridad de columnas de esa vista.
--   · Una credencial no pertenece a una entidad de lectura amplia.
--
-- RLS: habilitado SIN policies. Es el deny explícito — nadie lee ni escribe por
-- la API; solo las RPC SECURITY DEFINER de abajo y service_role (BYPASSRLS).
-- El advisor lo reporta como INFO rls_enabled_no_policy: es intencional.

SET lock_timeout = '5s';

-- ---------------------------------------------------------------- credenciales
CREATE TABLE IF NOT EXISTS public.kiosk_credentials (
    employee_id  UUID   PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
    pin_hash     TEXT        NOT NULL,
    rotated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_by   UUID        REFERENCES public.employees(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.kiosk_credentials ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.kiosk_credentials IS
    'Hash bcrypt del PIN de kiosco. RLS sin policies a propósito: acceso solo vía RPC SECURITY DEFINER. Nunca exponer pin_hash a la API.';

-- ------------------------------------------------------- rate limit por device
CREATE TABLE IF NOT EXISTS public.kiosk_pin_attempts (
    id           BIGSERIAL PRIMARY KEY,
    device_id    UUID        NOT NULL,
    employee_id  UUID,
    succeeded    BOOLEAN     NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.kiosk_pin_attempts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_kiosk_pin_attempts_device_time
    ON public.kiosk_pin_attempts (device_id, created_at DESC);

COMMENT ON TABLE public.kiosk_pin_attempts IS
    'Intentos de PIN por dispositivo, para rate limiting. Retención 30 días vía purge-sync-logs-daily.';

-- Backfill: hashea los PIN actuales para que el cutover del frontend no obligue
-- a rotar todo el mismo día. Los PIN siguen siendo débiles (derivados del code)
-- hasta la Fase 3 de rotación — esto solo mueve el almacenamiento, no la fuerza.
INSERT INTO public.kiosk_credentials (employee_id, pin_hash)
SELECT e.id, extensions.crypt(e.kiosk_pin, extensions.gen_salt('bf', 10))
FROM public.employees e
WHERE e.kiosk_pin IS NOT NULL AND btrim(e.kiosk_pin) <> ''
ON CONFLICT (employee_id) DO NOTHING;

-- ------------------------------------------------------------------ verificar
-- Identidad ya conocida (carné escaneado) → una sola comparación.
-- Devuelve solo un booleano: nunca filtra el PIN ni el hash.
CREATE OR REPLACE FUNCTION public.verify_kiosk_pin(
    p_device_id    UUID,
    p_device_token UUID,
    p_employee_id  UUID,
    p_pin          TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_branch_id BIGINT;
    v_hash      TEXT;
    v_fails     INT;
    v_ok        BOOLEAN := false;
BEGIN
    -- 1. El dispositivo debe estar vinculado y activo.
    SELECT branch_id INTO v_branch_id
    FROM public.kiosk_devices
    WHERE id = p_device_id
      AND device_token = p_device_token
      AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
      AND revoked_at IS NULL;

    IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
    END IF;

    -- 2. Rate limit: 10 fallos en 5 min por dispositivo.
    SELECT count(*) INTO v_fails
    FROM public.kiosk_pin_attempts
    WHERE device_id = p_device_id
      AND succeeded = false
      AND created_at > now() - INTERVAL '5 minutes';

    IF v_fails >= 10 THEN
        INSERT INTO public.kiosk_pin_attempts (device_id, employee_id, succeeded)
        VALUES (p_device_id, p_employee_id, false);
        RAISE EXCEPTION 'KIOSK_PIN_RATE_LIMITED';
    END IF;

    -- 3. Comparación bcrypt contra un único empleado.
    SELECT pin_hash INTO v_hash
    FROM public.kiosk_credentials
    WHERE employee_id = p_employee_id;

    IF v_hash IS NOT NULL THEN
        v_ok := (extensions.crypt(p_pin, v_hash) = v_hash);
    END IF;

    INSERT INTO public.kiosk_pin_attempts (device_id, employee_id, succeeded)
    VALUES (p_device_id, p_employee_id, v_ok);

    RETURN json_build_object('ok', v_ok);
END $$;

REVOKE EXECUTE ON FUNCTION public.verify_kiosk_pin(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.verify_kiosk_pin(UUID, UUID, UUID, TEXT) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.verify_kiosk_pin IS
    'Verifica el PIN de UN empleado desde un kiosco vinculado. anon a propósito (el kiosco es pre-login); valida device_token internamente y aplica rate limit.';

-- -------------------------------------------------------------------- rotar
-- El PIN se genera en el cliente (aleatorio), se muestra una vez y acá solo
-- entra su hash. El servidor nunca ve ni guarda el PIN en claro.
CREATE OR REPLACE FUNCTION public.set_kiosk_pin(
    p_employee_id UUID,
    p_pin         TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor UUID;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['staff_list'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_pin IS NULL OR length(btrim(p_pin)) < 6 THEN
        RAISE EXCEPTION 'PIN_TOO_SHORT';
    END IF;

    -- Autoría server-side: nunca del parámetro del cliente.
    v_actor := (SELECT auth_employee_id());

    INSERT INTO public.kiosk_credentials (employee_id, pin_hash, rotated_at, rotated_by)
    VALUES (p_employee_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), now(), v_actor)
    ON CONFLICT (employee_id) DO UPDATE
        SET pin_hash   = EXCLUDED.pin_hash,
            rotated_at = now(),
            rotated_by = v_actor;
END $$;

REVOKE EXECUTE ON FUNCTION public.set_kiosk_pin(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_kiosk_pin(UUID, TEXT) TO authenticated, service_role;
