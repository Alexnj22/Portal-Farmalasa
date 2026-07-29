-- C3.3 (parcial) — SECURITY DEFINER sin gate: revocar las que authenticated no debe llamar.
--
-- Contexto: de las 69 funciones SECURITY DEFINER ejecutables por `authenticated`,
-- 24 no contienen ninguna llamada a `auth_*`. Esta migración cierra las 3 que no
-- son llamadas por el frontend en absoluto. Las 8 de `pedidos` (que sí saltan el
-- gate del modulo) se tratan aparte porque cambian lo que ven los usuarios.
--
-- 1. notify_missing_roster    — solo la invoca el cron `roster-missing-alert-saturday`.
--                               Expuesta a authenticated permitía a cualquier empleado
--                               insertar un announcement HIGH dirigido a toda la empresa.
--                               + BUG: filtraba employees por status='ACTIVE', valor que
--                               no existe (los 50 empleados son 'ACTIVO'), asi que v_th_ids
--                               siempre era NULL y el aviso caia en target_type='ALL'
--                               en vez de ir solo a Talento Humano (role_id=11).
-- 2. upsert_proveedor_from_dte — solo la llaman sync-purchase-emails y
--                               backfill-proveedores-dte, ambas con SERVICE_ROLE_KEY.
--                               Escribe en proveedores_maestro, que tiene RLS por modulo.
-- 3. validate_role_headcount  — sin callers en src/, en supabase/functions/, en ninguna
--                               otra funcion SQL, ni en constraint o trigger. Codigo muerto;
--                               se revoca en vez de dropear por ser reversible.

SET lock_timeout = '5s';

-- ── 1. notify_missing_roster: fix del status + revoke ────────────────────────
CREATE OR REPLACE FUNCTION public.notify_missing_roster()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_next_monday   date;
  v_roster_count  int;
  v_th_ids        text[];
  v_target_type   text;
  v_target_value  jsonb;
BEGIN
  -- Saturday + 2 days = next Monday
  v_next_monday := CURRENT_DATE + 2;

  SELECT COUNT(*) INTO v_roster_count
  FROM employee_rosters
  WHERE week_start_date = v_next_monday;

  -- Rosters already exist → nothing to do
  IF v_roster_count > 0 THEN RETURN; END IF;

  -- Resolve TH recipients (role_id = 11). El status canonico es 'ACTIVO'.
  SELECT ARRAY_AGG(id::text) INTO v_th_ids
  FROM employees
  WHERE role_id = 11 AND status = 'ACTIVO';

  IF v_th_ids IS NOT NULL AND array_length(v_th_ids, 1) > 0 THEN
    v_target_type  := 'EMPLOYEE';
    v_target_value := to_jsonb(v_th_ids);
  ELSE
    v_target_type  := 'ALL';
    v_target_value := NULL;
  END IF;

  INSERT INTO announcements
    (title, message, target_type, target_value, read_by, is_archived, priority, metadata)
  VALUES (
    'Horario de próxima semana no configurado',
    'No se ha publicado ningún horario para la semana del ' ||
      to_char(v_next_monday, 'DD/MM/YYYY') ||
      '. Si no se configura antes del lunes, el kiosk usará el último horario disponible. Configura los horarios en el módulo de Turnos.',
    v_target_type,
    v_target_value,
    '[]'::jsonb,
    false,
    'HIGH',
    jsonb_build_object(
      'source',          'cron-roster-check',
      'next_week_start', v_next_monday::text,
      'triggered_at',    now()::text
    )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notify_missing_roster() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.notify_missing_roster() TO service_role;

-- ── 2. upsert_proveedor_from_dte: solo edge functions (service_role) ─────────
REVOKE EXECUTE ON FUNCTION public.upsert_proveedor_from_dte(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.upsert_proveedor_from_dte(jsonb) TO service_role;

-- ── 3. validate_role_headcount: codigo muerto ───────────────────────────────
REVOKE EXECUTE ON FUNCTION public.validate_role_headcount(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.validate_role_headcount(integer, integer) TO service_role;
