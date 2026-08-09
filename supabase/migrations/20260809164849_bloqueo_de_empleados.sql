SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- Bloquear a una persona: por tiempo o indefinido.
--
-- Nace de una pregunta del usuario el 2026-08-09: «¿ante algo de seguridad no
-- podría quitar el acceso y sesión?». La respuesta corta era que no —el access
-- token es un papel firmado y PostgREST le mira la firma y la fecha, no si la
-- sesión existe—, así que revocar dejaba hasta 15 minutos de lectura.
--
-- El bloqueo sí puede cortar por PETICIÓN, y esta migración pone las piezas:
-- el dato, la pregunta (`auth_no_bloqueado`) y las dos acciones. El corte en la
-- superficie RLS va aparte, con policies RESTRICTIVE (B3).
--
-- `blocked_until`:  NULL = no bloqueado · 'infinity' = indefinido
--                   una fecha = bloqueado hasta esa fecha, y se libera solo.
-- Un solo campo y una sola comparación: no hace falta un booleano al lado que
-- pueda contradecirlo.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS blocked_until  timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS blocked_at     timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_by     uuid;

COMMENT ON COLUMN public.employees.blocked_until IS
  'NULL = sin bloqueo; ''infinity'' = bloqueo indefinido; una fecha = bloqueo que se libera solo al pasarla.';

-- Índice parcial: sólo interesan las filas bloqueadas, que son un puñado.
CREATE INDEX IF NOT EXISTS idx_employees_blocked
  ON public.employees(blocked_until) WHERE blocked_until IS NOT NULL;

-- ── La pregunta ─────────────────────────────────────────────────────────────
-- «¿La persona de esta petición NO está bloqueada?». Se responde por petición.
--
-- Devuelve TRUE cuando no hay empleado que resolver (service_role, o un usuario
-- sin ficha): esta función es un FRENO, no un permiso. Si no reconoce a nadie no
-- tiene a quién frenar, y negar ahí rompería los caminos de servicio sin cerrar
-- nada que no estuviera ya cerrado por las policies de permiso.
--
-- Resuelve al empleado con la misma lógica que auth_employee_id(): por
-- employees.id, y si no, por employee_auth_accounts.
CREATE OR REPLACE FUNCTION public.auth_no_bloqueado()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE (e.id = (SELECT auth.uid())
        OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                    WHERE l.auth_user_id = (SELECT auth.uid())))
      AND e.blocked_until IS NOT NULL
      AND e.blocked_until > now()
  );
$fn$;

REVOKE EXECUTE ON FUNCTION public.auth_no_bloqueado() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auth_no_bloqueado() TO authenticated, service_role;

-- ── Bloquear ────────────────────────────────────────────────────────────────
-- Recibe hasta cuándo (NULL = indefinido) y el motivo. Mata todas las sesiones
-- de esa persona en el mismo acto: bloquear sin cerrar lo abierto dejaría el
-- acceso vivo hasta que venciera el token.
CREATE OR REPLACE FUNCTION public.block_employee(
  p_employee_id uuid,
  p_until       timestamptz DEFAULT NULL,
  p_reason      text        DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_yo       uuid;
  v_hasta    timestamptz;
  v_sesiones integer := 0;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('bloqueos', 'can_edit')) THEN
    RAISE EXCEPTION 'sin permiso para bloquear' USING ERRCODE = '42501';
  END IF;
  IF p_employee_id IS NULL THEN
    RAISE EXCEPTION 'falta la persona' USING ERRCODE = '22023';
  END IF;

  -- Quién soy sale del JWT, nunca de un parámetro.
  v_yo := (SELECT public.auth_employee_id());

  -- Bloquearse a uno mismo es un autogol sin vuelta: quedarías fuera y sin
  -- poder desbloquearte, porque desbloquear exige el permiso que acabás de
  -- perder. Se impide en la base y no sólo en la pantalla.
  IF v_yo IS NOT NULL AND v_yo = p_employee_id THEN
    RAISE EXCEPTION 'no podés bloquearte a vos mismo' USING ERRCODE = '22023';
  END IF;

  v_hasta := coalesce(p_until, 'infinity'::timestamptz);

  UPDATE public.employees
     SET blocked_until  = v_hasta,
         blocked_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         blocked_at     = now(),
         blocked_by     = v_yo
   WHERE id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no existe esa persona' USING ERRCODE = '22023';
  END IF;

  DELETE FROM auth.sessions WHERE user_id = p_employee_id;
  GET DIAGNOSTICS v_sesiones = ROW_COUNT;
  DELETE FROM public.session_activity WHERE user_id = p_employee_id;

  RETURN v_sesiones;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.block_employee(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.block_employee(uuid, timestamptz, text) TO authenticated, service_role;

-- ── Desbloquear ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unblock_employee(p_employee_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('bloqueos', 'can_edit')) THEN
    RAISE EXCEPTION 'sin permiso para desbloquear' USING ERRCODE = '42501';
  END IF;
  IF p_employee_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.employees
     SET blocked_until = NULL, blocked_reason = NULL, blocked_at = NULL, blocked_by = NULL
   WHERE id = p_employee_id AND blocked_until IS NOT NULL;

  RETURN FOUND;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.unblock_employee(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.unblock_employee(uuid) TO authenticated, service_role;
