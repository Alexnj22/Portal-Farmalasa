SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- El límite de inactividad deja de deducirse de los permisos y pasa a ser un
-- dato del cargo.
--
-- Cómo se decidía hasta hoy: 12 horas si el cargo tenía `can_view` sobre alguno
-- de `staff_list, schedules, monitor, requests, time_audit, permissions,
-- announcements`. La idea era «si es jefe, dale más tiempo». Pero dos de esa
-- lista no distinguen a un jefe: `requests` es donde uno PIDE vacaciones y
-- `announcements` donde uno LEE los avisos — los tiene todo el mundo.
--
-- Medido el 2026-08-17: los 21 Dependientes de Farmacia, 7 Regentes de
-- Enfermería, 6 Jefes de Sala y 5 Auxiliares de Bodega tenían **12 horas**, los
-- cuatro por `requests`. O sea que la computadora compartida del mostrador
-- quedaba abierta toda la jornada, que es exactamente lo que el límite corto
-- venía a evitar. Sólo 3 personas en toda la empresa tenían los 5 minutos, y
-- ninguna trabaja en una sala.
--
-- Es `feedback_un_rotulo_no_es_una_clave` aplicado a permisos: la lista se leyó
-- como si dijera «es jefe» y en realidad dice «tiene esta pantalla».
--
-- Decisión del usuario: que el tiempo sea configurable por cargo desde Permisos,
-- con todos en 5 minutos salvo Gerencia, Supervisión, Talento Humano y
-- Administración.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS idle_limit_min integer NOT NULL DEFAULT 5;

ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_idle_limit_min_check;
-- Piso de 5 minutos: por debajo, el portal se vuelve inusable y quien lo
-- configure se deja afuera a sí mismo. Techo de 24 horas.
ALTER TABLE public.roles
  ADD CONSTRAINT roles_idle_limit_min_check CHECK (idle_limit_min BETWEEN 5 AND 1440);

COMMENT ON COLUMN public.roles.idle_limit_min IS
  'Minutos sin usar el portal antes de cerrar la sesión. Se edita en Permisos. '
  'No aplica a la app instalada en un teléfono, que usa su propio plazo largo.';

-- Por id y no por nombre: el nombre del cargo es editable y esto tiene que
-- seguir apuntando al mismo cargo aunque lo renombren.
UPDATE public.roles SET idle_limit_min = 720
 WHERE id IN (
    2,   -- Gerente General
    13,  -- Supervisor/a de Ventas
    11,  -- Jefe/a de Talento Humano
    3,   -- Administrador
    36   -- Superusuario del Sistema
 );

-- ── La función pasa a LEER el dato, no a deducirlo ───────────────────────────
CREATE OR REPLACE FUNCTION public.session_idle_limit_minutes(p_user_id uuid, p_device_class text)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  WITH emp AS (
    SELECT e.id, e.role_id, e.secondary_role_id, e.system_role
    FROM public.employees e
    WHERE e.id = p_user_id
       OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                   WHERE l.auth_user_id = p_user_id)
    ORDER BY (e.id = p_user_id) DESC
    LIMIT 1
  )
  SELECT CASE
    -- 30 días: PWA instalada o build nativo. Es el teléfono de una persona y
    -- recibir avisos con la app cerrada es lo único para lo que existe.
    WHEN p_device_class = 'app' THEN 43200
    ELSE greatest(
      -- Manda el cargo. Con dos cargos gana el más largo, que es la misma
      -- semántica que tenía la regla vieja: cualquiera de los dos lo concedía.
      coalesce((SELECT max(r.idle_limit_min) FROM public.roles r, emp
                 WHERE r.id IN (emp.role_id, emp.secondary_role_id)), 5),
      -- El superadministrador del sistema no depende de que alguien le
      -- configure el cargo: se dejaría afuera de la pantalla donde se arregla.
      CASE WHEN EXISTS (SELECT 1 FROM emp WHERE emp.system_role = 'SUPERADMIN')
           THEN 720 ELSE 5 END
    )
  END;
$function$;
