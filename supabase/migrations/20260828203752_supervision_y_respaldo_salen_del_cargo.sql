SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- Grupos B y D: supervisión y aprobador de respaldo salen del cargo — paso 4 de
-- docs/PLAN-ROLES-SIN-SYSTEM-ROLE-2026-08-28.md
-- ════════════════════════════════════════════════════════════════════════════
--
-- Éste es el único paso que CAMBIA a quién alcanza cada regla, y el cambio está
-- decidido de antemano, no descubierto acá:
--
--   B · supervisión (rango >= 3)
--       antes:   Celina Escobar · EDWIN NUÑEZ · Rutilio Aleman
--       después: los tres + CARLOS MIGUEL RENDEROS HERNANDEZ
--
--   D · aprobador de respaldo (rango >= 4)
--       antes:   Celina Escobar, sola
--       después: Celina · Carlos · Rutilio
--
-- Carlos entra por decisión del usuario —«carlos renderos es administrador y
-- debe tener los permisos según administrador»—: tiene el cargo *Administrador*
-- y `system_role` en blanco, así que hasta hoy no entraba a NINGUNA de las dos
-- pese a su cargo. Rutilio entra a D porque el Gerente General está por encima
-- de Talento Humano en el organigrama, y la escala lo dice; con `system_role`
-- quedaba por debajo, que era justamente el orden invertido que originó todo
-- esto.
--
-- Y el efecto que más importa: el aprobador de respaldo pasa de **una sola
-- persona a tres**. Con una sola, una solicitud podía quedarse sin quién la
-- firme cada vez que esa persona estuviera de vacaciones.
--
-- Las cuatro se cambian con reemplazo quirúrgico sobre la definición viva: de
-- cada una cambia UN predicado. El chequeo posterior va con `strpos` y no con
-- `ILIKE`, porque en un patrón LIKE el guion bajo es comodín — ver la nota de
-- la migración de la llave maestra.

DO $mig$
DECLARE
  r     record;
  nuevo text;
  n     integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('auth_es_supervision', 'notificar_decision_diferencia',
                         'resolver_destinatarios_traslado', 'asignar_aprobador_solicitud')
  LOOP
    -- B · supervisión: de la lista de tres valores a «rango de supervisión para
    -- arriba». Con `>=` no hay lista que actualizar cuando aparezca un cargo.
    nuevo := replace(r.def,
      'e.system_role IN (''SUPERVISOR'', ''ADMIN'', ''SUPERADMIN'')',
      'public.rango_de_empleado(e.id) >= 3');
    nuevo := replace(nuevo,
      'e.system_role IN (''SUPERVISOR'',''ADMIN'',''SUPERADMIN'')',
      'public.rango_de_empleado(e.id) >= 3');
    -- D · aprobador de respaldo: dirección.
    nuevo := replace(nuevo,
      'upper(coalesce(e.system_role, '''')) IN (''ADMIN'',''SUPERADMIN'')',
      'public.rango_de_empleado(e.id) >= 4');

    IF nuevo = r.def THEN
      RAISE EXCEPTION 'No se encontró el predicado esperado en %(): la función cambió y hay que revisarla a mano.', r.proname;
    END IF;
    IF strpos(nuevo, 'system_role') > 0 THEN
      RAISE EXCEPTION 'Quedó una mención de system_role en %(): el reemplazo fue parcial.', r.proname;
    END IF;

    EXECUTE nuevo;
    n := n + 1;
  END LOOP;

  IF n <> 4 THEN
    RAISE EXCEPTION 'Se esperaban 4 funciones y se tocaron %.', n;
  END IF;
END
$mig$;

COMMENT ON FUNCTION public.auth_es_supervision() IS
  'Supervisión: rango >= 3 en el cargo (propio o secundario). Antes salía de employees.system_role, que decía SUPERVISOR del Gerente General y ADMIN de Talento Humano — el orden invertido del organigrama. NO confundir con auth_can_edit_scope_all(), que sobre Pedidos también lo tiene Bodega (2026-08-17).';

-- ── La huérfana ─────────────────────────────────────────────────────────────
-- Envoltorio de la columna. Varias migraciones de agosto lo usaban DENTRO de
-- policies de `approval_requests` —por eso buscar «system_role» en el texto de
-- las policies daba cero y era un falso negativo—, pero esas policies ya fueron
-- reemplazadas: hoy no lo llama ninguna policy, ninguna vista y ninguna otra
-- función.
DROP FUNCTION IF EXISTS public.auth_employee_system_role();
