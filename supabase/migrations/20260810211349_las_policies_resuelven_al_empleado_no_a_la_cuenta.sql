SET lock_timeout = '5s';

-- «No tienes permiso para crear solicitudes de inventario» — y el permiso estaba
-- puesto (2026-08-10).
--
-- El portal tiene DOS identidades para la misma persona: el `employees.id` y el
-- `auth.users.id` de la cuenta con la que entra. Para 22 de los 50 empleados
-- activos NO son el mismo valor: entran por una cuenta ligada en
-- `employee_auth_accounts` (las cuentas `*@staff.local` del carné). Por eso
-- existe `auth_employee_id()`, que resuelve la liga y devuelve SIEMPRE el id de
-- empleado — y por eso lo usa el resto del sistema.
--
-- Estas policies no lo usaban: comparaban una columna que guarda **id de
-- empleado** contra `auth.uid()`, que es **id de cuenta**. Verificado sobre los
-- datos, no sobre el nombre de la columna:
--
--   approval_requests.employee_id ......... 13 de 13 son de empleado
--   audit_logs.user_id ................... 13,654 de 13,702
--   user_dashboard_prefs.user_id ......... 16 de 16
--   minmax_change_requests / pedidos_snapshots ... vacías, pero el frontend
--                                                  escribe `user.id` = empleado
--
-- O sea que esas 22 personas no podían crear NI VER sus solicitudes, ni dejar
-- registro en la bitácora, ni guardar el acomodo de su tablero. Reproducido con
-- Yessica Hernandez (Regente de Enfermería, entra como `p5ghy5rp@staff.local`):
-- `auth_employee_id()` la ubica, tiene el permiso del módulo, y el INSERT
-- devuelve «new row violates row-level security policy» — que es exactamente el
-- texto que el widget traduce a «no tienes permiso».
--
-- Se reescribe cada policy SOBRE SU PROPIA DEFINICIÓN y no a mano: son diez, y
-- varias llevan además la rama del aprobador con su scope. Si alguna no
-- contiene el patrón esperado, la migración FALLA en vez de dejarla a medias.
DO $mig$
DECLARE
  p        record;
  v_qual   text;
  v_chk    text;
  v_cmd    text;
  v_roles  text;
  v_sql    text;
  v_viejo  constant text := '( SELECT auth.uid() AS uid)';
  v_nuevo  constant text := '( SELECT auth_employee_id() AS auth_employee_id)';
  v_hechas int := 0;
  v_objetivo constant text[] := ARRAY[
    'approval_requests.approval_requests_insert',
    'approval_requests.approval_requests_select',
    'audit_logs.audit_logs_insert',
    'minmax_change_requests.mmcr_select',
    'pedidos_snapshots.snapshots_insert',
    'pedidos_snapshots.snapshots_select',
    'pedidos_snapshots.snapshots_delete',
    'user_dashboard_prefs.owner_insert',
    'user_dashboard_prefs.owner_select',
    'user_dashboard_prefs.owner_update'
  ];
BEGIN
  FOR p IN
    SELECT c.relname AS tabla, pol.polname AS nombre, pol.polcmd AS cmd,
           pg_get_expr(pol.polqual, pol.polrelid)      AS qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS chk,
           coalesce(nullif(array_to_string(ARRAY(
             SELECT r.rolname FROM pg_roles r WHERE r.oid = ANY(pol.polroles)), ', '), ''), 'PUBLIC') AS roles
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (c.relname || '.' || pol.polname) = ANY(v_objetivo)
  LOOP
    IF coalesce(p.qual,'') || coalesce(p.chk,'') NOT LIKE '%' || v_viejo || '%' THEN
      RAISE EXCEPTION 'La policy %.% ya no compara contra auth.uid() como se esperaba — revisar a mano', p.tabla, p.nombre;
    END IF;

    v_qual := replace(p.qual, v_viejo, v_nuevo);
    v_chk  := replace(p.chk,  v_viejo, v_nuevo);
    v_cmd  := CASE p.cmd WHEN 'a' THEN 'INSERT' WHEN 'r' THEN 'SELECT'
                         WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END;

    v_sql := format('DROP POLICY %I ON public.%I', p.nombre, p.tabla);
    EXECUTE v_sql;

    v_sql := format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR %s TO %s',
                    p.nombre, p.tabla, v_cmd, p.roles);
    IF v_qual IS NOT NULL THEN v_sql := v_sql || format(' USING (%s)', v_qual); END IF;
    IF v_chk  IS NOT NULL THEN v_sql := v_sql || format(' WITH CHECK (%s)', v_chk); END IF;
    EXECUTE v_sql;

    v_hechas := v_hechas + 1;
  END LOOP;

  IF v_hechas <> array_length(v_objetivo, 1) THEN
    RAISE EXCEPTION 'Se esperaban % policies y se reescribieron % — revisar a mano',
      array_length(v_objetivo, 1), v_hechas;
  END IF;
END
$mig$;

-- `session_activity` es el único caso mezclado de verdad: 163 filas con id de
-- empleado y 19 con id de cuenta, porque la escriben dos caminos distintos.
-- Acá no se reemplaza, se ACEPTAN LOS DOS: con sólo `auth.uid()` cada persona
-- veía una parte de sus propias sesiones y la otra le quedaba invisible.
DROP POLICY IF EXISTS session_activity_select_own ON public.session_activity;
CREATE POLICY session_activity_select_own ON public.session_activity
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR user_id = (SELECT auth_employee_id()));

COMMENT ON POLICY session_activity_select_own ON public.session_activity IS
  'Acepta las dos identidades: la columna guarda id de empleado en unas filas y de cuenta en otras.';
