SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- El paso previo a cerrar `audit_logs` y `employee_events`.
--
-- Los dos comparten defecto: LA VISTA PIDE LOS DATOS EN VEZ DE HACER LA
-- PREGUNTA. El frontend se trae la tabla entera y calcula en el cliente algo que
-- el servidor contesta en una línea — y por eso la tabla tiene que estar abierta.
--
-- Estas tres funciones contestan la pregunta. Recién con los llamadores
-- cambiados se pueden cerrar las policies.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ¿Está de vacaciones o incapacitado? ─────────────────────────────────────
-- El enrutador de aprobadores (`requestsSlice.js` → `isUnavailable`) leía los
-- eventos DE OTRA PERSONA para calcular un sí/no, y lo dispara cualquier
-- empleado al crear una solicitud. Si se cerrara `employee_events` sin esto, la
-- lectura devolvería cero filas y la función diría «disponible» SIN ERROR: la
-- solicitud se iría a alguien de vacaciones. Un fallo callado.
--
-- Porta la lógica de JS al pie de la letra, incluidas sus coerciones:
--   · `!meta?.endDate` es falsy para null, ausente y cadena vacía → nullif(...,'')
--   · la comparación de fechas era de TEXTO ('YYYY-MM-DD' se ordena bien), no de
--     date; se conserva así para no cambiar el comportamiento con un valor raro
--   · el «hoy» de JS era `toISOString()`, o sea UTC — de ahí el AT TIME ZONE
CREATE OR REPLACE FUNCTION public.empleado_no_disponible(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.employee_events e
    WHERE e.employee_id = p_employee_id
      AND e.type IN ('VACATION','DISABILITY')
      AND e.date <= (now() AT TIME ZONE 'UTC')::date
      AND coalesce(e.metadata->>'status','') NOT IN ('CANCELLED','SUPERSEDED')
      AND (
        nullif(e.metadata->>'endDate','') IS NULL
        OR nullif(e.metadata->>'endDate','') >= to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')
      )
  );
$fn$;

REVOKE EXECUTE ON FUNCTION public.empleado_no_disponible(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.empleado_no_disponible(uuid) TO authenticated, service_role;

-- ── El historial de una sucursal ────────────────────────────────────────────
-- Son dos RPC y no una genérica a propósito: cada una exige el permiso de SU
-- vista. Una función «historial de cualquier objeto» tendría que aceptar
-- `auditview OR branches OR minmax` para todo el mundo, que es más flojo que lo
-- que cada pantalla necesita.
CREATE OR REPLACE FUNCTION public.audit_log_de_sucursal(p_branch_id text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  IF NOT ((SELECT public.auth_has_module_permission('branches','can_view'))
       OR (SELECT public.auth_has_module_permission('auditview','can_view'))) THEN
    RAISE EXCEPTION 'sin permiso para ver el historial de la sucursal' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT json_agg(to_json(t) ORDER BY t.created_at DESC)
    FROM (
      SELECT a.* FROM public.audit_logs a
      WHERE a.target_id = p_branch_id
      ORDER BY a.created_at DESC
      LIMIT 200
    ) t
  ), '[]'::json);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.audit_log_de_sucursal(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.audit_log_de_sucursal(text) TO authenticated, service_role;

-- ── El historial de un producto en Mín·Máx ──────────────────────────────────
-- Reproduce el filtro que hacía el cliente, incluido el OR con
-- MINMAX_ZERO_ALL_BRANCHES (un evento global que no lleva sucursal).
CREATE OR REPLACE FUNCTION public.audit_log_de_producto(
  p_actions      text[],
  p_target_id    text,
  p_sucursal_id  text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  IF NOT ((SELECT public.auth_has_module_permission('minmax','can_view'))
       OR (SELECT public.auth_has_module_permission('auditview','can_view'))) THEN
    RAISE EXCEPTION 'sin permiso para ver el historial del producto' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT json_agg(to_json(t) ORDER BY t.created_at DESC)
    FROM (
      SELECT a.id, a.user_name, a.user_id, a.action, a.details, a.created_at
      FROM public.audit_logs a
      WHERE a.action = ANY(p_actions)
        AND a.target_id = p_target_id
        AND (p_sucursal_id IS NULL
             OR a.details->>'sucursal_id' = p_sucursal_id
             OR a.action = 'MINMAX_ZERO_ALL_BRANCHES')
      ORDER BY a.created_at DESC
      LIMIT 80
    ) t
  ), '[]'::json);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.audit_log_de_producto(text[], text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.audit_log_de_producto(text[], text, text) TO authenticated, service_role;
