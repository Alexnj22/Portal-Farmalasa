SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- El rango sale del CARGO, no de la persona — paso 1 de
-- docs/PLAN-ROLES-SIN-SYSTEM-ROLE-2026-08-28.md
-- ════════════════════════════════════════════════════════════════════════════
--
-- Decisión del usuario: «la verdad system role no tiene sentido, para eso está
-- el rol que es el cargo, al cual se le asignan permisos por vistas y cosas.
-- mejor hagamos más fuertes los roles y eliminemos system role».
--
-- `employees.system_role` es un rango escrito POR PERSONA que repite algo que el
-- organigrama de `roles` ya dice, y que se le contradice: marcaba `SUPERVISOR` a
-- la cima de la empresa (Gerente General) y `ADMIN` a un cargo que cuelga de
-- Administrador (Talento Humano). Reportado al toparse con un aviso mal
-- dirigido: «rutilio no es supervisor, celina no es supervisor».
--
-- Este paso NO cambia el comportamiento de nada: agrega la columna, la puebla y
-- deja los dos helpers. Nadie los lee todavía. Los grupos de funciones se pasan
-- de a uno en los pasos siguientes, cada uno enfrentado contra la foto que se
-- congeló antes de empezar.

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS rango smallint NOT NULL DEFAULT 0;

-- Escala ORDENADA a propósito: así «de este nivel para arriba» se escribe `>=`
-- y no una lista de literales que hay que ir actualizando cada vez que aparece
-- un cargo. Es justamente lo que hacía `system_role`, que obligaba a enumerar
-- ('SUPERVISOR','ADMIN','SUPERADMIN') en cada consulta y a acordarse de todas.
ALTER TABLE public.roles
  DROP CONSTRAINT IF EXISTS roles_rango_valido;
ALTER TABLE public.roles
  ADD CONSTRAINT roles_rango_valido CHECK (rango BETWEEN 0 AND 4);

COMMENT ON COLUMN public.roles.rango IS
  'Escalón del cargo para escalar una decisión: 0 colaborador · 1 subjefatura de sala · 2 jefatura · 3 supervisión · 4 dirección. Ordenado: se compara con >=, nunca con una lista de valores. Reemplaza a employees.system_role, que decía lo mismo por persona y podía contradecir al organigrama.';

-- ── El mapeo, cargo por cargo ───────────────────────────────────────────────
-- Sale del organigrama que ya vive en `parent_role_id`, no de lo que cada ficha
-- tenía escrito. Los que no se nombran quedan en 0.
UPDATE public.roles SET rango = 4 WHERE name IN (
  'Gerente General',                    -- la cima: parent_role_id nulo
  'Administrador',                      -- cuelga del Gerente General
  'Jefe/a de Talento Humano'            -- hoy ADMIN, y es quien firma de respaldo
);
UPDATE public.roles SET rango = 3 WHERE name IN (
  'Supervisor/a de Ventas',
  'Supervisor del Departamento Medico y Enfermería'
);
UPDATE public.roles SET rango = 2 WHERE name IN (
  'Jefe/a de Sala',
  'Jefe/a de Compras y Logistica'       -- jefatura de área: manda en Bodega
);
UPDATE public.roles SET rango = 1 WHERE name IN (
  'Subjefe/a de Sala'
);

-- ── Los dos helpers ─────────────────────────────────────────────────────────
-- STABLE para poder envolverlos en `(SELECT …)` dentro de una policy y que
-- Postgres los evalúe UNA vez y no por fila (regla 3 de CLAUDE.md: sin el
-- initplan, un count() de 27K filas pasó de 19 ms a 25 s).

-- ⚠️ El `greatest` sobre los DOS cargos no es un detalle. Alexander Melgar
-- (Salud 1) e Idalia Serrano (Salud 4) son Regentes de Enfermería con
-- `secondary_role_id = Subjefe/a de Sala`, y es de ahí de donde sale su
-- `SUBJEFE` de hoy. Mirando sólo `role_id` perderían su subjefatura en silencio
-- —sin error y sin fila de menos—, que es exactamente el modo de falla que este
-- plan existe para no repetir.
CREATE OR REPLACE FUNCTION public.rango_de_empleado(p_employee_id uuid)
RETURNS smallint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(max(r.rango), 0)::smallint
    FROM public.employees e
    JOIN public.roles r ON r.id IN (e.role_id, e.secondary_role_id)
   WHERE e.id = p_employee_id;
$function$;

COMMENT ON FUNCTION public.rango_de_empleado(uuid) IS
  'El escalón de una persona: el MAYOR entre su cargo y su cargo secundario. Con dos cargos gana el más alto — es la misma semántica que ya tenía session_idle_limit_minutes y la que hace que los dos regentes con subjefatura de sala la conserven.';

CREATE OR REPLACE FUNCTION public.auth_rango()
RETURNS smallint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT public.rango_de_empleado(public.auth_employee_id());
$function$;

COMMENT ON FUNCTION public.auth_rango() IS
  'El escalón de quien está pidiendo. Envolver SIEMPRE en (SELECT auth_rango()) dentro de una policy.';

REVOKE EXECUTE ON FUNCTION public.rango_de_empleado(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.auth_rango()            FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rango_de_empleado(uuid) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.auth_rango()            TO authenticated, service_role;
