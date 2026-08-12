-- Cuando el titular no está, su jefe inmediato hereda el permiso — y sólo
-- mientras dure la ausencia.
--
-- El portal ya sabía las tres cosas que hacen falta, pero no las había juntado:
--
--   · quién está de vacaciones o incapacitado → `empleado_no_disponible()`
--   · quién es el jefe inmediato              → `roles.parent_role_id`
--   · `resolveApprover` ya sube por esa jerarquía y SALTA al no disponible
--
-- Lo que faltaba es que eso ELIGE a quién se le asigna la solicitud, pero no le
-- DA el permiso para resolverla. Medido el 2026-08-12: el Supervisor de Ventas
-- era el único empleado activo con «Solicitudes → Aprobar»; su jefe inmediato
-- —Administrador— no lo tenía, ni los seis Jefes de Sala. Así que al irse de
-- vacaciones el enrutador designaba correctamente a un sustituto que después no
-- podía ni abrir la bandeja, y las solicitudes se acumulaban.
--
-- ── La regla ──────────────────────────────────────────────────────────────
-- Heredo `X` si soy el jefe inmediato de un cargo que tiene `X`, ese cargo
-- tiene al menos una persona activa, y TODAS están no disponibles.
--
-- «Todas» y no «alguna» a propósito: si el cargo tiene dos personas y una está,
-- no hay vacío que cubrir. Y «al menos una activa» evita que un cargo vacío
-- —sin nadie— le regale permisos al de arriba para siempre: sin esa condición,
-- `NOT EXISTS (disponible)` es verdadero de forma trivial sobre el conjunto
-- vacío, que es la trampa clásica del cuantificador universal.
--
-- ── Por qué NO hereda cualquier permiso ───────────────────────────────────
-- La tentación es hacerlo general. Sería un agujero: cuando Talento Humano se
-- va de vacaciones, su jefe heredaría TODO lo suyo, incluido ver expedientes,
-- salarios y anticipos de la gente. Una ausencia no es una promoción.
--
-- Así que la herencia vale sólo para una lista corta y explícita, la de
-- resolver solicitudes, y `can_edit` no se hereda nunca. `requests_personales`
-- queda FUERA por la misma razón: sus solicitudes hablan de la persona
-- —vacaciones, incapacidad, anticipo— y verlas es abrir el expediente. Si algún
-- día se decide que sí, se agrega acá y en ningún otro lado.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.auth_hereda_por_ausencia(p_module_key text, p_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    -- La lista corta. Fuera de acá no se hereda nada, pase lo que pase.
    p_module_key = ANY (ARRAY['requests', 'requests_facturacion',
                              'requests_inventario', 'traslados', 'minmax'])
    AND p_action = ANY (ARRAY['can_view', 'can_approve'])
    AND EXISTS (
      SELECT 1
      FROM public.roles hijo
      JOIN public.role_permissions rp
        ON rp.role_id = hijo.id
       AND rp.module_key = p_module_key
      WHERE hijo.parent_role_id = (SELECT public.auth_employee_role_id())
        AND CASE p_action
              WHEN 'can_view'    THEN rp.can_view
              WHEN 'can_approve' THEN rp.can_approve
              ELSE false
            END
        -- El cargo tiene gente…
        AND EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.role_id = hijo.id AND e.status = 'ACTIVO'
        )
        -- …y no queda ni una disponible.
        AND NOT EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.role_id = hijo.id
            AND e.status = 'ACTIVO'
            AND NOT public.empleado_no_disponible(e.id)
        )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.auth_hereda_por_ausencia(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auth_hereda_por_ausencia(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.auth_hereda_por_ausencia(text, text) IS
  'Verdadero si quien consulta es jefe inmediato de un cargo que tiene ese permiso y TODAS sus personas activas estan de vacaciones o incapacitadas. Solo modulos de solicitudes, solo can_view/can_approve.';

-- ── Engancharla ───────────────────────────────────────────────────────────
-- Va de ÚLTIMA en la cadena de OR a propósito: es el término más caro (recorre
-- los cargos hijos y consulta employee_events por cada persona) y el que menos
-- veces resulta verdadero. Los tres de arriba se copian tal cual estaban.
CREATE OR REPLACE FUNCTION public.auth_has_module_permission(p_module_key text, p_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    (SELECT public.auth_is_su())
    OR EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = public.auth_employee_role_id()
        AND rp.module_key = p_module_key
        AND CASE p_action
              WHEN 'can_view'    THEN rp.can_view
              WHEN 'can_edit'    THEN rp.can_edit
              WHEN 'can_approve' THEN rp.can_approve
              ELSE false
            END
    )
    OR EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = public.auth_employee_secondary_role_id()
        AND rp.module_key = p_module_key
        AND CASE p_action
              WHEN 'can_view'    THEN rp.can_view
              WHEN 'can_edit'    THEN rp.can_edit
              WHEN 'can_approve' THEN rp.can_approve
              ELSE false
            END
    )
    OR (SELECT public.auth_hereda_por_ausencia(p_module_key, p_action));
$$;
