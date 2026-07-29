-- Candado de mantenimiento: panel de administración (grupo Sistema).
--
-- Tres cosas:
--   1. `get_lockable_modules()` — la lista de módulos donde el candado SÍ hace
--      algo, derivada de las policies y funciones reales.
--   2. `lock_module` valida contra esa lista (antes aceptaba cualquiera de los 93).
--   3. Permiso `maintenance` para la vista nueva.
--
-- ══ POR QUE HACE FALTA LA LISTA ══
--
-- El candado vive DENTRO de `auth_can_edit_any(ARRAY[...])`. Bloquear un módulo
-- cuyo key no aparece en ninguno de esos arrays no hace absolutamente nada — y
-- hasta hoy `lock_module` aceptaba cualquiera de los 93 módulos de
-- role_permissions, así que se podía bloquear `conteo_inventario`, ver el banner
-- puesto, y seguir guardando como si nada. Un candado que miente es peor que no
-- tener candado.
--
-- Hoy son 27 de 93. La lista NO se hardcodea: se deriva de `pg_policies` y de
-- los cuerpos de las funciones, así que cuando alguien agregue una policy nueva
-- con `auth_can_edit_any(ARRAY['x'])`, `x` aparece sola. Un diccionario a mano
-- se desactualiza en silencio, que es justo el problema que tenía el módulo.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_lockable_modules()
RETURNS TABLE(module_key text, veces integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $function$
  WITH fuentes AS (
    SELECT COALESCE(qual, with_check) AS src FROM pg_policies WHERE schemaname = 'public'
    UNION ALL
    SELECT p.prosrc FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
  ),
  claves AS (
    SELECT trim(both '''' from m[1]) AS module_key
    FROM fuentes,
         regexp_matches(src, 'auth_can_edit_any\(ARRAY\[([^\]]+)\]', 'g') a(arr),
         regexp_matches(a.arr[1], '''[^'']+''', 'g') m
  )
  SELECT c.module_key, count(*)::integer AS veces
  FROM claves c
  -- solo módulos que además existen en role_permissions: si un array quedó con
  -- un key viejo tras un rename, no tiene sentido ofrecerlo.
  WHERE EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.module_key = c.module_key)
  GROUP BY c.module_key
  ORDER BY c.module_key;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_lockable_modules() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_lockable_modules() TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.lock_module(p_module_key text, p_reason text DEFAULT NULL::text, p_hours integer DEFAULT 4)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp_id   uuid;
  v_emp_name text;
  v_hours    int := LEAST(GREATEST(COALESCE(p_hours, 4), 1), 24);
  v_now      timestamptz := now();
BEGIN
  v_emp_id := public.auth_employee_id();
  IF v_emp_id IS NULL THEN
    RAISE EXCEPTION 'NO_EMPLOYEE: no se pudo resolver tu empleado; no se puede tomar el candado';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE module_key = p_module_key) THEN
    RAISE EXCEPTION 'UNKNOWN_MODULE: % no es un módulo conocido', p_module_key;
  END IF;

  -- Un candado sobre un módulo que ninguna policy consulta no bloquea nada.
  IF NOT EXISTS (SELECT 1 FROM public.get_lockable_modules() g WHERE g.module_key = p_module_key) THEN
    RAISE EXCEPTION 'MODULE_NOT_LOCKABLE: % no tiene escritura gateada por auth_can_edit_any, así que el candado no lo frenaría', p_module_key;
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
  WHERE module_locks.expires_at <= v_now
     OR module_locks.locked_by_id = EXCLUDED.locked_by_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ALREADY_LOCKED: % ya está bloqueado por otra persona', p_module_key;
  END IF;

  RETURN jsonb_build_object('ok', true, 'module_key', p_module_key,
                            'locked_by', COALESCE(v_emp_name, 'Sin nombre'),
                            'expires_at', v_now + make_interval(hours => v_hours));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.lock_module(text, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.lock_module(text, text, integer) TO authenticated, service_role;


-- Permiso de la vista nueva. Se copia el de `orphan_objects` (roles 13 y 33 con
-- can_edit): es el mismo público de las otras vistas de infra del grupo Sistema.
-- Sumar a alguien más es un click en Permisos de Acceso.
--
-- Ojo: ver el panel NO da poder de bloquear. `lock_module` sigue exigiendo
-- can_edit sobre el módulo que se quiere bloquear.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, scope)
SELECT rp.role_id, 'maintenance', true, true, COALESCE(rp.scope, 'ALL')
FROM public.role_permissions rp
WHERE rp.module_key = 'orphan_objects'
ON CONFLICT (role_id, module_key) DO NOTHING;
