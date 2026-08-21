-- El alcance deja de fallar abierto.
--
-- `auth_module_scope()` terminaba en `'ALL'` cuando el cargo no tenía fila para
-- ese módulo. O sea: **no sé cuál es tu alcance → todos**. Es el mismo error de
-- forma que el que se acaba de cerrar en los traslados, y del mismo tipo mudo:
-- no lanza, no avisa, sólo muestra de más.
--
-- Hoy no hace daño porque quien no tiene fila tampoco tiene `can_view`, y las
-- policies siempre preguntan las dos cosas. Pero `auth_has_module_permission()`
-- **sí** considera la herencia por ausencia (`auth_hereda_por_ausencia`) y
-- `auth_module_scope()` **no**: el día que alguien herede `requests.can_view`
-- de un jefe ausente y su propio cargo no tenga fila de `requests`, la policy
-- le da permiso y esta función le da alcance global. Nadie lo decidió.
--
-- ── Qué cambia, medido antes de aplicar ───────────────────────────────────
-- Sobre los 49 empleados activos × los módulos que existen: cambian de alcance
-- **2,474 pares, y CERO de ellos tiene permiso**. O sea que hoy no se mueve ni
-- una pantalla — se cierra la puerta por la que todavía no entró nadie.
--
-- ── El orden de las ramas, que es lo que hace que no cambie nada ──────────
-- 1. La fila PROPIA manda siempre (primario, después secundario; 'ALL' en
--    cualquiera de los dos gana, que es el modelo de unión de Bloque 8).
-- 2. Sin fila propia y siendo superusuario → 'ALL'. Va DESPUÉS de la fila
--    propia a propósito: puesta antes, le habría ensanchado a la cuenta
--    `Superusuario del Sistema` su `requests_personales` de BRANCH a ALL —
--    medido, era el único par que se movía con permiso. Un superusuario con
--    una fila explícita la respeta.
-- 3. Sin fila propia, el alcance HEREDADO: el de quien está cubriendo. Es la
--    respuesta correcta, no 'ALL' ni 'MINE' — si sustituyo a alguien, heredo
--    su alcance. Sale de `mis_permisos_heredados()`, la MISMA función que le
--    arma los permisos al navegador, que ya resuelve 'ALL' > 'BRANCH' > 'MINE'
--    entre varias fuentes.
-- 4. Terminal: **'MINE'**, el más restrictivo. Sin fila, sin ser superusuario y
--    sin heredar, no hay permiso — así que el alcance no debería habilitar
--    nada.
--
-- ── Por qué la rama 3 va detrás de un guardián ────────────────────────────
-- `mis_permisos_heredados()` cuesta **13 ms y 1,385 buffers** (medido con
-- EXPLAIN ANALYZE). Esta función la llaman las policies, así que aunque el
-- envoltorio `(SELECT ...)` la evalúe una sola vez por consulta, pagarla en
-- cada consulta de cada tabla sería regalar cientos de milisegundos a quien
-- simplemente no tiene ese módulo.
--
-- `hay_alguien_no_disponible()` contesta lo mismo por el lado barato: **0.116
-- ms y 1 buffer**. Y no es una aproximación — las DOS ramas de
-- `hereda_por_ausencia_emp` exigen que alguien esté no disponible, así que si
-- no hay nadie ausente no hay nada que heredar, y saltarse el cálculo da
-- exactamente el mismo resultado. Hoy devuelve `false`: cero vacaciones y cero
-- incapacidades vigentes sobre las 4 filas de `employee_events`.
--
-- CASE y no COALESCE en la cadena final: CASE tiene cortocircuito garantizado
-- en SQL, así que la rama cara sólo se evalúa si de verdad se llegó hasta ahí.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.hay_alguien_no_disponible()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.employee_events e
     WHERE e.type IN ('VACATION','DISABILITY')
       AND e.date <= (now() AT TIME ZONE 'UTC')::date
       AND coalesce(e.metadata->>'status','') NOT IN ('CANCELLED','SUPERSEDED')
       AND (
         nullif(e.metadata->>'endDate','') IS NULL
         OR nullif(e.metadata->>'endDate','') >= to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')
       )
  );
$function$;

COMMENT ON FUNCTION public.hay_alguien_no_disponible() IS
  '¿Hay AL MENOS UNA persona de vacaciones o incapacitada ahora mismo? Es el mismo predicado de empleado_no_disponible() sin el filtro por persona, y sirve de guardián barato: si nadie está ausente, nadie hereda un permiso por ausencia, así que todo el cálculo de herencia se puede saltar. Medido: 0.116 ms contra los 13 ms de mis_permisos_heredados().';

REVOKE ALL ON FUNCTION public.hay_alguien_no_disponible() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hay_alguien_no_disponible() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auth_module_scope(p_module_key text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH propio AS (
    SELECT
      (SELECT rp.scope FROM public.role_permissions rp
        WHERE rp.role_id = public.auth_employee_role_id()
          AND rp.module_key = p_module_key)                     AS primario,
      (SELECT rp.scope FROM public.role_permissions rp
        WHERE rp.role_id = public.auth_employee_secondary_role_id()
          AND rp.module_key = p_module_key)                     AS secundario
  )
  SELECT CASE
    WHEN 'ALL' IN (coalesce(p.primario, ''), coalesce(p.secundario, '')) THEN 'ALL'
    WHEN p.primario   IS NOT NULL THEN p.primario
    WHEN p.secundario IS NOT NULL THEN p.secundario
    WHEN (SELECT public.auth_is_su()) THEN 'ALL'
    WHEN (SELECT public.hay_alguien_no_disponible()) THEN coalesce(
      (SELECT h.scope FROM public.mis_permisos_heredados() h
        WHERE h.module_key = p_module_key LIMIT 1),
      'MINE')
    ELSE 'MINE'
  END
  FROM propio p;
$function$;

COMMENT ON FUNCTION public.auth_module_scope(text) IS
  'El alcance del usuario para un módulo. La fila propia manda (ALL en primario o secundario gana); sin fila propia, el superusuario da ALL, después el alcance HEREDADO de quien se está cubriendo, y el terminal es MINE. Terminaba en ALL —fallaba abierto— hasta el 2026-08-21: sin fila no hay permiso, así que el alcance no debe habilitar nada. La rama heredada va detrás de hay_alguien_no_disponible() porque cuesta 13 ms.';
