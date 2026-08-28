SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- `empleados_por_rango` — paso 6 de
-- docs/PLAN-ROLES-SIN-SYSTEM-ROLE-2026-08-28.md
-- ════════════════════════════════════════════════════════════════════════════
--
-- El enrutador de aprobadores del navegador arma sus consultas a mano:
-- `.in('system_role', ['ADMIN','SUPERADMIN'])`, `.eq('system_role','SUPERVISOR')`.
-- O sea que la regla de «quién está por encima» vive en el frente, escrita con
-- literales, y hay que acordarse de todos los valores en cada consulta.
--
-- Con el rango la regla se escribe UNA vez y acá: el navegador pide un tramo de
-- la escala y la base contesta quiénes son. Es la misma corrección que ya se le
-- hizo a los rótulos de catálogo — la lista no se escribe a mano, sale de la
-- tabla.
--
-- **Un tramo y no un mínimo**, porque el enrutador prueba por escalones: primero
-- la jefatura de la sala (1..2), después supervisión (3..3) y recién al final
-- dirección (4..4). Con un `>=` a secas, el primer intento se llevaría también a
-- la dirección y nadie escalaría nunca.

CREATE OR REPLACE FUNCTION public.empleados_por_rango(
  p_min       smallint,
  p_max       smallint DEFAULT 4,
  p_branch_id integer  DEFAULT NULL,
  p_excluir   uuid     DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  -- Orden por nombre a propósito. Las consultas que esto reemplaza no tenían
  -- ORDER BY, así que con dos personas del mismo escalón el aprobador propuesto
  -- salía de lo que devolviera el plan ese día. Determinista se puede reproducir
  -- un caso; sin orden, no.
  SELECT coalesce(array_agg(e.id ORDER BY e.name), ARRAY[]::uuid[])
    FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND public.rango_de_empleado(e.id) BETWEEN p_min AND p_max
     AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
     AND (p_excluir   IS NULL OR e.id <> p_excluir);
$function$;

COMMENT ON FUNCTION public.empleados_por_rango(smallint, smallint, integer, uuid) IS
  'Quiénes están en un tramo de la escala de cargos, activos, opcionalmente de una sala y excluyendo a alguien. Reemplaza los .in(system_role, [...]) que el navegador escribía a mano. Devuelve en orden de nombre para que el aprobador propuesto sea reproducible.';

REVOKE EXECUTE ON FUNCTION public.empleados_por_rango(smallint, smallint, integer, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.empleados_por_rango(smallint, smallint, integer, uuid) TO authenticated, service_role;
