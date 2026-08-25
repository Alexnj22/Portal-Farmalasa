SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- La configuración de la bitácora la toca el jefe de SU sala.
--
-- ── Qué pidió el usuario ───────────────────────────────────────────────────
-- «permite modificar los horarios por sucursal, para limpieza y servicios
-- sanitarios (que lo puedan modificar los jefes)». Los horarios de limpieza no
-- son una decisión de la norma sino de cada local —a qué hora abre, cuándo se
-- barre— y hoy había que pedírselo a Gerencia o al Regente.
--
-- ── El permiso y el ALCANCE van juntos, o es un agujero ────────────────────
-- Las policies de INSERT y UPDATE de `bitacora_areas` sólo miraban el permiso
-- `bitacoras_configurar`, sin mirar la sala. Con los cargos que lo tenían hasta
-- hoy —Gerente General, Regente, Supervisión, todos con alcance ALL— eso no se
-- notaba. En el momento en que se le da a un jefe de sala, «sin mirar la sala»
-- significa que el jefe de Salud 1 puede reescribir las franjas de Salud 4.
--
-- O sea: dar el permiso sin cerrar el alcance no habría fallado, habría
-- funcionado de más. Por eso las dos cosas entran en la misma migración.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · Las policies miran la sala cuando el alcance no es ALL ─────────────
-- `(SELECT …)` alrededor de cada `auth_*` es obligatorio (incidente 2026-07-08):
-- sin el initplan, Postgres las evalúa POR FILA.
DROP POLICY IF EXISTS bitacora_areas_insert ON public.bitacora_areas;
CREATE POLICY bitacora_areas_insert ON public.bitacora_areas
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.auth_has_module_permission('bitacoras_configurar', 'can_edit'))
        AND (
            (SELECT public.auth_module_scope('bitacoras_configurar')) = 'ALL'
            OR branch_id = (SELECT public.auth_employee_branch_id())
        )
    );

DROP POLICY IF EXISTS bitacora_areas_update ON public.bitacora_areas;
CREATE POLICY bitacora_areas_update ON public.bitacora_areas
    FOR UPDATE TO authenticated
    USING (
        (SELECT public.auth_has_module_permission('bitacoras_configurar', 'can_edit'))
        AND (
            (SELECT public.auth_module_scope('bitacoras_configurar')) = 'ALL'
            OR branch_id = (SELECT public.auth_employee_branch_id())
        )
    )
    WITH CHECK (
        (SELECT public.auth_has_module_permission('bitacoras_configurar', 'can_edit'))
        AND (
            (SELECT public.auth_module_scope('bitacoras_configurar')) = 'ALL'
            OR branch_id = (SELECT public.auth_employee_branch_id())
        )
    );

-- ── 2 · Jefe y subjefe de sala pueden configurar la suya ──────────────────
-- Con alcance BRANCH, que es lo que la policy de arriba acaba de hacer
-- significar algo. No se toca ningún otro cargo.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, scope)
SELECT r.id, 'bitacoras_configurar', true, true, 'BRANCH'
  FROM public.roles r
 WHERE r.name IN ('Jefe/a de Sala', 'Subjefe/a de Sala')
ON CONFLICT (role_id, module_key)
DO UPDATE SET can_view = true, can_edit = true, scope = 'BRANCH';
