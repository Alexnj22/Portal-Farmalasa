-- Candado de mantenimiento por módulo (F0 del PLAN-MINMAX-Y-CANDADO-2026-07-29).
--
-- Problema: no existe forma de decir "estoy trabajando en este módulo, no escriban".
-- Durante una migración sobre tablas calientes, cualquier usuario puede guardar en
-- paralelo y dejar datos a medio camino entre el esquema viejo y el nuevo.
--
-- Enganche: auth_can_edit_any() es el cuello de botella real de escritura del portal
-- (59 policies sobre 30 tablas + 23 RPCs). Un solo AND ahí cubre todo, incluido quien
-- llame a PostgREST directo salteándose la UI.
--
-- LÍMITE EXPLÍCITO: service_role saltea RLS por completo, así que este candado NO
-- detiene crons ni edge functions. Detiene personas. Para frenar un cron hay que
-- desactivar su job en cron.job aparte.
--
-- Nota de seguridad: agregar el chequeo NO cambia el comportamiento de service_role.
-- De las 23 funciones que llaman auth_can_edit_any, 22 no lo eximen, y como
-- auth_employee_role_id() devuelve NULL para ese rol, esas 22 ya devolvían false hoy.

SET lock_timeout = '5s';

-- ─── 1. Tabla ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.module_locks (
  id             bigserial   PRIMARY KEY,
  module_key     text        NOT NULL UNIQUE,
  locked_by_id   uuid        NOT NULL REFERENCES public.employees(id),
  locked_by_name text        NOT NULL,   -- desnormalizado: el banner no hace join
  reason         text,
  locked_at      timestamptz NOT NULL DEFAULT now(),
  -- Válvula de seguridad: un candado olvidado un viernes NO deja el módulo en
  -- solo-lectura todo el fin de semana. La RPC lo acota a [1, 24] horas.
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_locks_expires_after_locked CHECK (expires_at > locked_at)
);

-- Cubre la FK a employees (regla 2 de CLAUDE.md) y el lookup del helper.
CREATE INDEX IF NOT EXISTS idx_module_locks_locked_by ON public.module_locks (locked_by_id);
CREATE INDEX IF NOT EXISTS idx_module_locks_key_exp   ON public.module_locks (module_key, expires_at DESC);

ALTER TABLE public.module_locks ENABLE ROW LEVEL SECURITY;

-- TODOS deben poder leerlo: sin SELECT nadie ve el banner y el candado es invisible.
DROP POLICY IF EXISTS module_locks_select ON public.module_locks;
CREATE POLICY module_locks_select ON public.module_locks
  FOR SELECT TO authenticated USING (true);

-- Sin policies de INSERT/UPDATE/DELETE a propósito: se toca solo por las RPCs
-- SECURITY DEFINER de abajo, que son las que validan quién puede.

REVOKE ALL ON public.module_locks FROM anon;
GRANT SELECT ON public.module_locks TO authenticated;

-- ─── 2. Helper: ¿alguno de estos módulos está bloqueado PARA MÍ? ──────────────
-- Semántica deliberada: si CUALQUIERA de los módulos del array está bloqueado,
-- bloquea. auth_can_edit_any(ARRAY['minmax','pedidos']) con minmax bloqueado deja
-- de permitir escribir product_stock_params aunque el usuario entre por pedidos.
-- Es sobre-bloqueo INTENCIONAL: si estoy tocando MIN/MAX, nada escribe esa tabla
-- venga por donde venga.
--
-- El titular del candado nunca se bloquea a sí mismo.
CREATE OR REPLACE FUNCTION public.auth_module_locked(p_modules text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.module_locks ml
    WHERE ml.module_key = ANY(p_modules)
      AND ml.expires_at > now()
      AND ml.locked_by_id IS DISTINCT FROM public.auth_employee_id()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.auth_module_locked(text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auth_module_locked(text[]) TO authenticated, service_role;

-- ─── 3. El cambio de una línea en auth_can_edit_any ──────────────────────────
-- Cuerpo idéntico al original salvo el `NOT auth_module_locked(...) AND`.
-- SUPERADMIN saltea el candado (escotilla de emergencia).
CREATE OR REPLACE FUNCTION public.auth_can_edit_any(p_modules text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    COALESCE(((select auth.jwt()) -> 'user_metadata') ->> 'systemRole', '') = 'SUPERADMIN'
    OR (
      NOT public.auth_module_locked(p_modules)
      AND (
        EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.role_id = public.auth_employee_role_id()
            AND rp.module_key = ANY(p_modules)
            AND rp.can_edit
        )
        OR EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.role_id = public.auth_employee_secondary_role_id()
            AND rp.module_key = ANY(p_modules)
            AND rp.can_edit
        )
      )
    );
$$;

-- ─── 4. RPCs para tomar y soltar ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lock_module(
  p_module_key text,
  p_reason     text DEFAULT NULL,
  p_hours      int  DEFAULT 4
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp_id   uuid;
  v_emp_name text;
  v_hours    int := LEAST(GREATEST(COALESCE(p_hours, 4), 1), 24);
  v_now      timestamptz := now();
BEGIN
  -- Si no resuelve al empleado, RECHAZA. Sin esto se podría crear un candado
  -- que su propio autor no puede abrir (auth_module_locked compara contra
  -- auth_employee_id(): si es NULL, IS DISTINCT FROM da true y se autobloquea).
  v_emp_id := public.auth_employee_id();
  IF v_emp_id IS NULL THEN
    RAISE EXCEPTION 'NO_EMPLOYEE: no se pudo resolver tu empleado; no se puede tomar el candado';
  END IF;

  -- Nada de candados fantasma por un typo: el módulo tiene que existir.
  -- Va ANTES del chequeo de permiso a propósito: si no, un nombre mal escrito
  -- responde "no tenés permiso" y manda a buscar el problema donde no está.
  IF NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE module_key = p_module_key) THEN
    RAISE EXCEPTION 'UNKNOWN_MODULE: % no es un módulo conocido', p_module_key;
  END IF;

  IF NOT public.auth_has_module_permission(p_module_key, 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en %', p_module_key;
  END IF;

  SELECT name INTO v_emp_name FROM public.employees WHERE id = v_emp_id;

  INSERT INTO public.module_locks (module_key, locked_by_id, locked_by_name, reason, locked_at, expires_at)
  VALUES (p_module_key, v_emp_id, COALESCE(v_emp_name, 'Sin nombre'), p_reason, v_now,
          v_now + make_interval(hours => v_hours))
  ON CONFLICT (module_key) DO UPDATE SET
    locked_by_id   = EXCLUDED.locked_by_id,
    locked_by_name = EXCLUDED.locked_by_name,
    reason         = EXCLUDED.reason,
    locked_at      = EXCLUDED.locked_at,
    expires_at     = EXCLUDED.expires_at
  -- Solo el titular puede renovar/reasignar un candado vigente ajeno.
  WHERE module_locks.expires_at <= v_now
     OR module_locks.locked_by_id = EXCLUDED.locked_by_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ALREADY_LOCKED: % ya está bloqueado por otra persona', p_module_key;
  END IF;

  RETURN jsonb_build_object('ok', true, 'module_key', p_module_key,
                            'locked_by', COALESCE(v_emp_name, 'Sin nombre'),
                            'expires_at', v_now + make_interval(hours => v_hours));
END;
$$;

CREATE OR REPLACE FUNCTION public.unlock_module(p_module_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp_id uuid := public.auth_employee_id();
  v_owner  uuid;
BEGIN
  SELECT locked_by_id INTO v_owner FROM public.module_locks WHERE module_key = p_module_key;
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  -- El titular, o cualquiera que administre permisos: siempre tiene que haber
  -- una forma de liberar un candado atascado sin tocar la BD a mano.
  IF v_owner IS DISTINCT FROM v_emp_id
     AND NOT public.auth_has_module_permission('permissions', 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: solo el titular del candado o un administrador de permisos puede liberarlo';
  END IF;

  DELETE FROM public.module_locks WHERE module_key = p_module_key;
  RETURN jsonb_build_object('ok', true, 'module_key', p_module_key);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lock_module(text, text, int)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unlock_module(text)           FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.lock_module(text, text, int)  TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.unlock_module(text)           TO authenticated, service_role;

-- ─── 5. Realtime ─────────────────────────────────────────────────────────────
-- Sin esto la suscripción del cliente (AuthContext) se declara y NUNCA se
-- dispara: el candado tardaría hasta el próximo login en llegarle al resto del
-- equipo, que es justo lo contrario de lo que hace falta.
--
-- Es seguro sumarla a la publicación: es una tabla de pocas filas con
-- escrituras contadas (un lock/unlock por sesión de trabajo). No se parece en
-- nada a `product_stock_params`, que concentraba el 99.8% del decode de WAL y
-- por eso se sacó de la publicación en el Bloque 4.3.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'module_locks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.module_locks;
  END IF;
END $$;

COMMENT ON TABLE public.module_locks IS
  'Candado de mantenimiento por módulo: pone el módulo en solo-lectura para todos menos su titular. NO detiene crons ni edge functions (service_role saltea RLS).';
