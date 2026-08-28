SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- Grupo C: «la jefatura de esta sala» sale del cargo — paso 2 de
-- docs/PLAN-ROLES-SIN-SYSTEM-ROLE-2026-08-28.md
-- ════════════════════════════════════════════════════════════════════════════
--
-- Tres triggers de aviso preguntan `system_role IN ('JEFE','SUBJEFE')` para
-- saber a quién de la sala avisarle. Pasa a ser `rango BETWEEN 1 AND 2`
-- —subjefatura o jefatura— leído del cargo.
--
-- **Verificado ANTES de aplicar**, enfrentando las dos reglas sobre las 48
-- fichas activas: los mismos 9 nombres, misma huella md5
-- (7d711dec0a6d7e482fb35714cc4acd13). Incluye a Alexander Melgar e Idalia
-- Serrano, que son Regentes de Enfermería y llegan por su `secondary_role_id =
-- Subjefe/a de Sala` — que es de donde salía su `SUBJEFE`.
--
-- ── Por qué esto es un reemplazo quirúrgico y no tres funciones reescritas ──
-- De cada cuerpo cambia UNA línea, y son tres triggers largos (el de traslado
-- pasa de 120 líneas, con la sugerencia de sala alternativa adentro).
-- Transcribirlos enteros para cambiar un predicado es la forma barata de
-- introducir un defecto en el 99% que no había que tocar. Se toma la definición
-- VIVA, se le cambia el predicado y se vuelve a crear: lo que no es ese
-- predicado queda idéntico por construcción.
--
-- El `RAISE` si no encuentra el texto es la mitad que hace confiable a la otra:
-- un `replace` que no coincide no falla, devuelve la cadena igual — y la
-- migración habría «pasado» sin cambiar nada.

DO $mig$
DECLARE
  r      record;
  nuevo  text;
  n      integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('notificar_resolucion_traslado',
                         'notificar_resolucion_envio',
                         'notificar_resolucion_movimiento_inventario')
  LOOP
    nuevo := replace(r.def,
      'e.system_role IN (''JEFE'',''SUBJEFE'')',
      'public.rango_de_empleado(e.id) BETWEEN 1 AND 2');
    nuevo := replace(nuevo,
      'system_role IN (''JEFE'',''SUBJEFE'')',
      'public.rango_de_empleado(id) BETWEEN 1 AND 2');

    IF nuevo = r.def THEN
      RAISE EXCEPTION 'No se encontró el predicado de jefatura en %(): la función cambió y hay que revisarla a mano.', r.proname;
    END IF;
    IF nuevo ILIKE '%system_role%' THEN
      RAISE EXCEPTION 'Quedó una mención de system_role en %(): el reemplazo fue parcial.', r.proname;
    END IF;

    EXECUTE nuevo;
    n := n + 1;
  END LOOP;

  IF n <> 3 THEN
    RAISE EXCEPTION 'Se esperaban 3 funciones y se tocaron %.', n;
  END IF;
END
$mig$;
